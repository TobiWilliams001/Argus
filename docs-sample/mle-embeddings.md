# Machine Learning Engineering — Vectors and Semantic Search

## What Are Vector Embeddings?

A vector embedding is a numerical representation of data — text, images, audio — as a point in a high-dimensional space. The key property is that semantically similar items are placed close together in this space. "King" and "Queen" have similar embeddings. "King minus Man plus Woman" produces a vector close to "Queen." This arithmetic is not magic — it emerges from training on massive text corpora.

Embeddings are produced by neural networks. The most widely used text embedding model is the Transformer architecture, originally described in the 2017 paper "Attention Is All You Need" by Vaswani et al. Models like BERT, Sentence-BERT, and OpenAI's text-embedding-ada-002 produce embeddings used in production search and retrieval systems.

## Cosine Similarity

Once data is embedded, you need to measure how similar two vectors are. The most common metric is cosine similarity, which measures the angle between two vectors rather than the distance between them.

Cosine similarity = (A · B) / (||A|| × ||B||)

Where A · B is the dot product and ||A||, ||B|| are the magnitudes. The result is between -1 and 1. A score of 1 means identical direction (semantically identical), 0 means orthogonal (unrelated), and -1 means opposite.

Cosine similarity is preferred over Euclidean distance for text because it is insensitive to the magnitude of the vectors — a long document and a short document on the same topic will have a high cosine similarity despite their length difference.

## How Semantic Search Works

Traditional keyword search finds documents containing exact words from the query. Semantic search finds documents that are conceptually related, even if they use different words.

The pipeline is: embed the query → compute cosine similarity against all stored embeddings → return the top-k most similar chunks → pass those chunks to an LLM to synthesise an answer.

This architecture is called RAG — Retrieval-Augmented Generation. It grounds the LLM's response in actual retrieved content, reducing hallucination and enabling the model to answer questions about private data it was not trained on.

## Chunking Strategy

Documents must be split into chunks before embedding. The chunking strategy significantly affects retrieval quality.

**Fixed-size chunking** splits text every N characters. Simple but may cut sentences mid-thought.

**Sentence-boundary chunking** splits at sentence ends. Preserves meaning but chunks vary in size.

**Overlapping chunks** include the last K characters of the previous chunk in the next one. This ensures context at chunk boundaries is not lost.

The optimal chunk size depends on the embedding model's context window and the nature of the documents. For most models, 300-600 characters with 10-20% overlap is a good starting point.

## Vector Databases

Storing embeddings as plain arrays and doing brute-force cosine similarity search is fine for small corpora (under ~100,000 chunks). For larger corpora, dedicated vector databases use approximate nearest-neighbour (ANN) algorithms to search billions of vectors in milliseconds.

**FAISS** (Facebook AI Similarity Search) is an open-source library for efficient ANN search. It supports multiple index types: flat (exact), IVF (inverted file, partitioned), and HNSW (hierarchical navigable small world graphs).

**HNSW** builds a layered graph where each node connects to its nearest neighbours. Search starts at the top layer (coarse graph) and progressively descends to finer layers. It achieves sub-millisecond search at scale.

Production vector databases include Pinecone, Weaviate, Qdrant, and Chroma. For local use, FAISS or Chroma are the standard choices.

## TF-IDF vs. Embeddings

TF-IDF (Term Frequency-Inverse Document Frequency) is a classical information retrieval technique. It scores terms by how frequently they appear in a document relative to how rare they are across all documents. TF-IDF is fast, interpretable, and works well for keyword-heavy queries.

Embeddings capture semantic meaning that TF-IDF misses. A query for "cardiac arrest" will not match a document about "heart attacks" using TF-IDF, but embedding similarity will score them highly.

Modern production systems often use hybrid search — combining TF-IDF (BM25) and embedding similarity — and then applying a reranker to produce the final ranking. This gives both keyword precision and semantic recall.
