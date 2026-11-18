-- pgvector powers semantic search over paper chunks (phase 2); pg_trgm helps fuzzy title matching.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
