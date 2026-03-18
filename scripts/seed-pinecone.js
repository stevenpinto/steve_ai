const path = require("path");

// Resolve modules from backend/node_modules since that's where dependencies are installed
const backendDir = path.join(__dirname, "../backend");
require("dotenv").config({ path: path.join(backendDir, ".env") });
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  try {
    return originalResolve.call(this, request, parent, ...args);
  } catch {
    return originalResolve.call(this, request, { ...parent, paths: [path.join(backendDir, "node_modules")] }, ...args);
  }
};

const fs = require("fs");
const pdfParse = require("pdf-parse");
const { Pinecone } = require("@pinecone-database/pinecone");
const { Document } = require("@langchain/core/documents");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { PineconeStore, PineconeEmbeddings } = require("@langchain/pinecone");

const SUPPORTED_EXTENSIONS = [".md", ".txt", ".pdf"];

async function loadDocuments(dir, metadata = {}) {
  const docs = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase()));

  for (const file of files) {
    const filePath = path.join(dir, file);
    const ext = path.extname(file).toLowerCase();
    let content;

    if (ext === ".pdf") {
      const buffer = fs.readFileSync(filePath);
      const pdf = await pdfParse(buffer);
      content = pdf.text;
      console.log(`  Parsed PDF: ${file} (${pdf.numpages} pages)`);
    } else {
      content = fs.readFileSync(filePath, "utf-8");
      console.log(`  Loaded: ${file}`);
    }

    docs.push(
      new Document({
        pageContent: content,
        metadata: {
          source: file,
          ...metadata,
        },
      })
    );
  }
  return docs;
}

async function seed() {
  console.log("Starting Pinecone seed...\n");

  // Validate env
  if (!process.env.PINECONE_API_KEY) {
    console.error("Missing PINECONE_API_KEY in backend/.env");
    process.exit(1);
  }

  const indexName = process.env.PINECONE_INDEX_NAME || "steve-ai";

  // Load documents
  const publicDir = path.join(__dirname, "../knowledge-base/public");
  const privateDir = path.join(__dirname, "../knowledge-base/private");

  const publicDocs = await loadDocuments(publicDir, { access: "public" });
  const privateDocs = await loadDocuments(privateDir, { access: "private" });

  console.log(`Loaded ${publicDocs.length} public docs, ${privateDocs.length} private docs`);

  // Split into chunks
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 200,
  });

  const publicChunks = await splitter.splitDocuments(publicDocs);
  const privateChunks = await splitter.splitDocuments(privateDocs);

  console.log(`Split into ${publicChunks.length} public chunks, ${privateChunks.length} private chunks`);

  // Initialize Pinecone
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pinecone.index(indexName);

  // Use Pinecone's built-in embedding model (included with your plan)
  const embeddings = new PineconeEmbeddings({
    apiKey: process.env.PINECONE_API_KEY,
    model: "multilingual-e5-large",
  });

  // Batch size limit for Pinecone's embedding model (multilingual-e5-large max is 96)
  const BATCH_SIZE = 90;

  async function seedInBatches(chunks, namespace) {
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`);
      await PineconeStore.fromDocuments(batch, embeddings, {
        pineconeIndex: index,
        namespace,
      });
    }
  }

  // Clear existing vectors before re-seeding
  console.log("\nClearing existing vectors...");
  await index.namespace("steve_public_index").deleteAll();
  await index.namespace("steve_private_index").deleteAll();
  console.log("Cleared.");

  // Seed public namespace
  if (publicChunks.length > 0) {
    console.log("\nSeeding steve_public_index namespace...");
    await seedInBatches(publicChunks, "steve_public_index");
    console.log("Public namespace seeded.");
  }

  // Seed private namespace
  if (privateChunks.length > 0) {
    console.log("\nSeeding steve_private_index namespace...");
    await seedInBatches(privateChunks, "steve_private_index");
    console.log("Private namespace seeded.");
  }

  console.log("\nDone! Knowledge base seeded into Pinecone.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
