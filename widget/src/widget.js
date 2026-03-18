const WIDGET_CSS = `__WIDGET_CSS__`; // Replaced at build time, or inlined below

class SteveAIWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.isOpen = false;
    this.isLoading = false;
    this.sessionId = this._generateSessionId();
  }

  connectedCallback() {
    this.mode = this.getAttribute("mode") || "public";
    this.apiUrl =
      this.getAttribute("api-url") || "http://localhost:3001";
    this._render();
    this._attachEvents();
  }

  _generateSessionId() {
    return "sess_" + Math.random().toString(36).substring(2, 15);
  }

  _render() {
    const isPrivate = this.mode === "private";
    const title = isPrivate ? "Ask Steve AI (Private)" : "Ask Steve AI";
    const subtitle = isPrivate
      ? "Authenticated access"
      : "Learn about Steve's experience";
    const greeting = isPrivate
      ? "Hey! You have full access. Ask me anything about Steve's work, projects, or strategy."
      : "Hi there! I'm Steve's AI assistant. Ask me about his experience, skills, leadership philosophy, or anything else you'd like to know.";

    this.shadowRoot.innerHTML = `
      <style>${WIDGET_CSS}</style>

      <button class="steve-ai-toggle" aria-label="Open chat">
        <svg class="chat-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
        </svg>
        <svg class="close-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>

      <div class="steve-ai-window">
        <div class="steve-ai-header">
          <div class="steve-ai-avatar">S</div>
          <div class="steve-ai-header-text">
            <h3>${title}</h3>
            <p>${subtitle}</p>
          </div>
        </div>

        <div class="steve-ai-messages">
          <div class="steve-ai-msg bot">${greeting}</div>
        </div>

        <div class="steve-ai-input-area">
          <textarea
            class="steve-ai-input"
            placeholder="Type your question..."
            rows="1"
          ></textarea>
          <button class="steve-ai-send" aria-label="Send message">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>

        <div class="steve-ai-footer">
          Powered by Steve AI
        </div>
      </div>
    `;
  }

  _attachEvents() {
    const toggle = this.shadowRoot.querySelector(".steve-ai-toggle");
    const window_ = this.shadowRoot.querySelector(".steve-ai-window");
    const input = this.shadowRoot.querySelector(".steve-ai-input");
    const sendBtn = this.shadowRoot.querySelector(".steve-ai-send");

    toggle.addEventListener("click", () => {
      this.isOpen = !this.isOpen;
      toggle.classList.toggle("open", this.isOpen);
      window_.classList.toggle("open", this.isOpen);
      if (this.isOpen) {
        setTimeout(() => input.focus(), 100);
      }
    });

    sendBtn.addEventListener("click", () => this._sendMessage());

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    // Auto-resize textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
    });
  }

  async _sendMessage() {
    const input = this.shadowRoot.querySelector(".steve-ai-input");
    const message = input.value.trim();

    if (!message || this.isLoading) return;

    this.isLoading = true;
    input.value = "";
    input.style.height = "auto";

    const sendBtn = this.shadowRoot.querySelector(".steve-ai-send");
    sendBtn.disabled = true;

    // Add user message
    this._addMessage(message, "user");

    // Show typing indicator
    const typingEl = this._addTypingIndicator();

    try {
      const endpoint =
        this.mode === "private" ? "/api/chat/private" : "/api/chat/public";

      const headers = { "Content-Type": "application/json" };
      const authToken = this.getAttribute("auth-token");
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const res = await fetch(`${this.apiUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          sessionId: this.sessionId,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Remove typing indicator and create the bot message bubble
      typingEl.remove();
      const messages = this.shadowRoot.querySelector(".steve-ai-messages");
      const msg = document.createElement("div");
      msg.className = "steve-ai-msg bot";
      messages.appendChild(msg);

      // Read the SSE stream
      let fullText = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines from the buffer
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.substring(6));
            if (data.token) {
              fullText += data.token;
              msg.innerHTML = this._renderMarkdown(fullText);
              messages.scrollTop = messages.scrollHeight;
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (parseErr) {
            if (parseErr.message === "Something went wrong.") throw parseErr;
          }
        }
      }

      // Add feedback buttons after stream completes
      this._addFeedbackButtons(msg, fullText, message);

    } catch (err) {
      console.error("Steve AI error:", err);
      if (typingEl.parentNode) typingEl.remove();
      this._addMessage(
        "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
        "bot"
      );
    } finally {
      this.isLoading = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  _addMessage(text, sender) {
    const messages = this.shadowRoot.querySelector(".steve-ai-messages");
    const msg = document.createElement("div");
    msg.className = `steve-ai-msg ${sender}`;

    if (sender === "bot") {
      msg.innerHTML = this._renderMarkdown(text);
    } else {
      msg.textContent = text;
    }

    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    return msg;
  }

  _addFeedbackButtons(msgEl, responseText, questionText) {
    const feedback = document.createElement("div");
    feedback.className = "steve-ai-feedback";
    feedback.innerHTML = `
      <div class="steve-ai-fb-row">
        <button class="steve-ai-fb-btn" data-rating="up" aria-label="Thumbs up">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66a4.8 4.8 0 0 0-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84A2.33 2.33 0 0 0 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z"/></svg>
        </button>
        <button class="steve-ai-fb-btn" data-rating="down" aria-label="Thumbs down">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M22 4h-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1h2V4zM2.17 11.12c-.11.25-.17.52-.17.8V13c0 1.1.9 2 2 2h5.5l-.92 4.65c-.05.22-.02.46.08.66.23.4.52.77.88 1.22L10 22l6.41-6.41c.38-.38.59-.89.59-1.42V6.34A2.33 2.33 0 0 0 14.66 4H6.56c-.71 0-1.37.37-1.72.97L2.17 11.12z"/></svg>
        </button>
      </div>
      <div class="steve-ai-fb-comment" style="display:none;">
        <textarea class="steve-ai-fb-input" placeholder="What was wrong with this response?" rows="2"></textarea>
        <button class="steve-ai-fb-submit">Send feedback</button>
      </div>
    `;

    const commentSection = feedback.querySelector(".steve-ai-fb-comment");
    const commentInput = feedback.querySelector(".steve-ai-fb-input");
    const submitBtn = feedback.querySelector(".steve-ai-fb-submit");
    let submitted = false;

    const sendFeedback = async (rating, comment) => {
      try {
        await fetch(`${this.apiUrl}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: questionText,
            response: responseText,
            rating,
            comment: comment || "",
            sessionId: this.sessionId,
          }),
        });
      } catch (err) {
        console.error("Feedback error:", err);
      }
    };

    feedback.querySelectorAll(".steve-ai-fb-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (submitted) return;

        const rating = btn.dataset.rating;
        feedback.querySelectorAll(".steve-ai-fb-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        if (rating === "up") {
          // Thumbs up — send immediately, no comment needed
          submitted = true;
          commentSection.style.display = "none";
          await sendFeedback("up", "");
        } else {
          // Thumbs down — show comment box
          commentSection.style.display = "block";
          commentInput.focus();
        }
      });
    });

    submitBtn.addEventListener("click", async () => {
      if (submitted) return;
      submitted = true;
      const comment = commentInput.value.trim();
      commentSection.innerHTML = '<span class="steve-ai-fb-thanks">Thanks for your feedback!</span>';
      await sendFeedback("down", comment);
    });

    // Allow Enter to submit comment (Shift+Enter for newline)
    commentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitBtn.click();
      }
    });

    msgEl.appendChild(feedback);
  }

  _renderMarkdown(text) {
    // Sanitize HTML entities first to prevent XSS
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**...** or __...__)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic (*...* or _..._) — avoid matching list items
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Markdown links [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bare URLs (https://... or http://...) — but not already inside an href
    html = html.replace(/(?<!href="|">)(https?:\/\/[^\s<,)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

    // Email addresses
    html = html.replace(/(?<!href="mailto:)([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1">$1</a>');

    // Phone numbers — formats like (303) 709-9623
    html = html.replace(/(\(\d{3}\)\s?\d{3}[-.]?\d{4})/g, '<a href="tel:$1">$1</a>');

    // Headers (## ... )
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');

    // Unordered list items (- item)
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs — split on double newlines
    html = html
      .split(/\n\n+/)
      .map((block) => {
        block = block.trim();
        if (!block) return "";
        // Don't wrap blocks that are already HTML elements
        if (/^<(h[1-6]|ul|ol|pre|li|blockquote)/.test(block)) return block;
        return `<p>${block.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    return html;
  }

  _addTypingIndicator() {
    const messages = this.shadowRoot.querySelector(".steve-ai-messages");
    const typing = document.createElement("div");
    typing.className = "steve-ai-msg bot typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    return typing;
  }
}

customElements.define("steve-ai-widget", SteveAIWidget);
