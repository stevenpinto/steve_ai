const { Pinecone } = require("@pinecone-database/pinecone");
const { PineconeStore, PineconeEmbeddings } = require("@langchain/pinecone");

let pineconeClient = null;

function getPineconeClient() {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
  }
  return pineconeClient;
}

function getEmbeddings() {
  return new PineconeEmbeddings({
    apiKey: process.env.PINECONE_API_KEY,
    model: "multilingual-e5-large",
  });
}

async function getRetriever(mode = "public") {
  const client = getPineconeClient();
  const index = client.index(process.env.PINECONE_INDEX_NAME);
  const embeddings = getEmbeddings();

  if (mode === "public") {
    // Public: only search the public namespace
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex: index,
      namespace: "steve_public_index",
    });

    return vectorStore.asRetriever({ k: 5, searchType: "similarity" });
  }

  // Private: query BOTH namespaces and merge results
  // Pinecone doesn't support cross-namespace queries, so we query each
  // namespace separately and combine the results ranked by score.
  const publicStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex: index,
    namespace: "steve_public_index",
  });

  const privateStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex: index,
    namespace: "steve_private_index",
  });

  // Return a custom retriever that merges both namespaces
  return {
    async invoke(query) {
      const [publicResults, privateResults] = await Promise.all([
        publicStore.similaritySearchWithScore(query, 5),
        privateStore.similaritySearchWithScore(query, 5),
      ]);

      // Merge and sort by score (higher = better match for cosine)
      const all = [
        ...publicResults.map(([doc, score]) => ({ doc, score })),
        ...privateResults.map(([doc, score]) => ({ doc, score })),
      ];

      all.sort((a, b) => b.score - a.score);

      // Return top 5 documents
      return all.slice(0, 5).map((item) => item.doc);
    },
  };
}

module.exports = { getPineconeClient, getEmbeddings, getRetriever };
