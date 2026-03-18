# Ask Steve AI

A dual AI chatbot widget (public + private) that can be embedded on any website. Powered by Claude, LangChain, and Pinecone with RAG (Retrieval-Augmented Generation) architecture.

The public agent answers questions using a curated knowledge base. The private agent (auth required) can access additional private documents. Both use semantic search to find relevant context before generating responses.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Chat Widget │────▶│  Express API     │────▶│   Pinecone   │
│  (Web Comp.) │◀────│  (Lambda-ready)  │────▶│  Vector DB   │
└──────────────┘ SSE └──────────────────┘     └──────────────┘
                            │
                            ▼
                      ┌──────────┐
                      │  Claude  │
                      │  (LLM)   │
                      └──────────┘
```

- **Widget** — Embeddable web component with Shadow DOM for style isolation. Zero dependencies. Supports streaming (SSE), markdown rendering, and feedback (thumbs up/down).
- **Backend** — Express API wrapped with `serverless-http` for AWS Lambda compatibility. Handles chat (public + private), feedback CRUD, and session history.
- **RAG Pipeline** — LangChain orchestrates Pinecone retrieval → Claude response generation. Public mode queries one namespace; private mode queries both and merges by similarity score.

## Project Structure

```
steve_ai/
├── backend/           Express API (Lambda-compatible)
│   ├── src/
│   │   ├── index.js          API routes (chat, feedback)
│   │   ├── chains/chat.js    LangChain RAG chain
│   │   ├── agents/prompts.js System prompts (public/private)
│   │   └── knowledge/        Pinecone retrieval logic
│   ├── local-runner.js       Local dev server (preserves SSE)
│   └── .env.example          Required environment variables
├── widget/            Embeddable chat widget
│   ├── src/
│   │   ├── widget.js         Web component (Shadow DOM)
│   │   └── widget.css        Widget styles
│   ├── build.js              Inlines CSS into single JS file
│   └── dist/                 Built widget (single .js file)
├── knowledge-base/    Your knowledge base documents
│   ├── public/               Public-facing docs (.md, .pdf, .txt)
│   └── private/              Auth-required docs
└── scripts/
    └── seed-pinecone.js      Seeds Pinecone from knowledge-base/
```

## Setup

### Prerequisites

- Node.js 18+
- [Anthropic API key](https://console.anthropic.com/)
- [Pinecone account](https://www.pinecone.io/) (free tier works)

### 1. Create Pinecone Index

Create an index in Pinecone with these settings:
- **Name:** `steve-ai` (or whatever you choose)
- **Dimensions:** 1024
- **Metric:** Cosine
- **Embedding model:** `multilingual-e5-large` (built into Pinecone)

### 2. Configure Environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your API keys:

```
ANTHROPIC_API_KEY=your-anthropic-api-key
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX_NAME=steve-ai
PORT=3001
NODE_ENV=development
```

### 3. Create Your Knowledge Base

Add `.md`, `.txt`, or `.pdf` files to `knowledge-base/public/` and `knowledge-base/private/`.

**Tips for good knowledge base documents:**
- Use clear, descriptive headers (these help semantic search find the right content)
- One topic per file works better than one giant file
- Structure documents with questions someone might ask (e.g., `## What technologies does the project use?`)
- Keep files under 50KB for optimal chunking
- Don't include sensitive information (API keys, passwords, etc.) in public docs

**Example file structure:**
```
knowledge-base/public/
├── about-me.md            Who you are, professional summary
├── contact-info.md        Phone, email, LinkedIn, etc.
├── faq.md                 Common questions and answers
├── project-example.md     A project you want to showcase
└── skills.md              Technical skills and expertise
```

### 4. Install, Seed, and Run

```bash
# Install backend dependencies
cd backend && npm install

# Seed Pinecone with your knowledge base
npm run seed

# Start the dev server
npm run dev

# In another terminal — build the widget
cd widget && npm install && npm run build
```

### 5. Test

Open `widget/index.html` in your browser, or run:

```bash
npx serve widget -p 3000
```

## Embedding the Widget

Add the built widget to any HTML page:

```html
<script src="path/to/steve-ai-widget.js"></script>
<steve-ai-widget
  mode="public"
  api-url="https://your-api-url.com"
></steve-ai-widget>
```

**Attributes:**
- `mode` — `"public"` (default) or `"private"`
- `api-url` — Your backend API URL

## Customizing the System Prompt

Edit `backend/src/agents/prompts.js` to change how the AI responds. The public and private agents have separate system prompts.

## Deploying to AWS

The backend is Lambda-ready via `serverless-http`. Deploy using the Serverless Framework, SAM, or CDK. The widget is a single static JS file — host it on S3/CloudFront or any CDN.

### Environment Variables (Lambda)

Set these in your Lambda configuration:
- `ANTHROPIC_API_KEY`
- `PINECONE_API_KEY`
- `PINECONE_INDEX_NAME`
- `ADMIN_KEY` — a secret key for accessing the feedback admin endpoints
- `NODE_ENV=production`

### GitHub Actions Secrets

The CI/CD workflow uses OIDC to authenticate with AWS. Add this secret in your repo under Settings → Secrets and variables → Actions:

- `AWS_ROLE_ARN` — the ARN of your IAM role with a trust policy for GitHub OIDC (e.g., `arn:aws:iam::123456789012:role/YourRoleName`)

## Tech Stack

- **LLM:** Claude (Anthropic) via LangChain
- **Vector DB:** Pinecone with `multilingual-e5-large` embeddings
- **Backend:** Node.js, Express, serverless-http
- **Widget:** Vanilla JS Web Component (Shadow DOM)
- **Streaming:** Server-Sent Events (SSE)
- **Infrastructure:** AWS Lambda, API Gateway, S3, CloudFront
