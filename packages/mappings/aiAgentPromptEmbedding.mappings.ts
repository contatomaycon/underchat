export const aiAgentPromptEmbeddingMappings = (embeddingDimensions: number) => {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        account_id: {
          type: 'keyword',
        },
        ai_agent_id: {
          type: 'keyword',
        },
        ai_agent_prompt_id: {
          type: 'keyword',
        },
        chunk_index: {
          type: 'integer',
        },
        chunk_text: {
          type: 'text',
        },
        embedding: {
          type: 'dense_vector',
          dims: embeddingDimensions,
          index: true,
          similarity: 'cosine',
        },
        has_embedding: {
          type: 'boolean',
        },
        created_at: {
          type: 'date',
        },
        content_fingerprint: {
          type: 'keyword',
        },
        embedding_model: {
          type: 'keyword',
        },
        updated_at: {
          type: 'date',
        },
        updated_at_epoch_millis: {
          type: 'long',
        },
      },
    },
  };
};
