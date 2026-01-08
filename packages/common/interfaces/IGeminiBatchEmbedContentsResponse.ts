export interface IGeminiBatchEmbedContentsResponse {
  embeddings?: Array<{
    values?: number[];
    embedding?: {
      values?: number[];
    };
  }>;
}
