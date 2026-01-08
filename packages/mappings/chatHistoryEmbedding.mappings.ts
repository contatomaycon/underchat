export const chatHistoryEmbeddingMappings = (embeddingDimensions: number) => {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        account_id: {
          type: 'keyword' as const,
        },
        chat_id: {
          type: 'keyword' as const,
        },
        ai_agent_id: {
          type: 'keyword' as const,
        },
        message_id: {
          type: 'keyword' as const,
        },
        message_text: {
          type: 'text' as const,
        },
        embedding: {
          type: 'dense_vector' as const,
          dims: embeddingDimensions,
          index: true,
          similarity: 'cosine' as const,
        },
        created_at: {
          type: 'date' as const,
        },
        phone: {
          type: 'keyword' as const,
        },
        quality_score: {
          type: 'float' as const,
        },
        is_useful: {
          type: 'boolean' as const,
        },
        is_assistant_response: {
          type: 'boolean' as const,
        },
      },
    },
  };
};
