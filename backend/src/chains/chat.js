const { ChatAnthropic } = require("@langchain/anthropic");
const { PromptTemplate } = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { getRetriever } = require("../knowledge/pinecone");
const {
  PUBLIC_SYSTEM_PROMPT,
  PRIVATE_SYSTEM_PROMPT,
} = require("../agents/prompts");

function formatDocs(docs) {
  return docs.map((doc) => doc.pageContent).join("\n\n---\n\n");
}

async function createChatChain(mode = "public") {
  const model = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-sonnet-4-20250514",
    temperature: 0.3,
    maxTokens: 512,
  });

  const systemPrompt =
    mode === "private" ? PRIVATE_SYSTEM_PROMPT : PUBLIC_SYSTEM_PROMPT;

  const retriever = await getRetriever(mode);

  const prompt = PromptTemplate.fromTemplate(`${systemPrompt}

CONTEXT FROM KNOWLEDGE BASE:
{context}

CONVERSATION HISTORY:
{history}

USER QUESTION: {question}

IMPORTANT: Always use the CONTEXT FROM KNOWLEDGE BASE above to answer. It contains Steve's real, up-to-date information including article titles, dates, project details, and work history. Do not say you don't have information if it appears in the context. Respond helpfully and specifically, citing details from the context. Keep responses concise — 2-4 sentences for simple questions, no more than a short paragraph for complex ones. Do not add filler, disclaimers, or suggest checking external sources when the answer is in the context.`);

  const chain = RunnableSequence.from([
    {
      context: async (input) => {
        const docs = await retriever.invoke(input.question);
        return formatDocs(docs);
      },
      question: (input) => input.question,
      history: (input) => input.history || "No previous conversation.",
    },
    prompt,
    model,
    new StringOutputParser(),
  ]);

  return chain;
}

module.exports = { createChatChain };
