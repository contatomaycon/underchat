export const internalChatMessageMappings = () => {
  return {
    mappings: {
      properties: {
        message_id: { type: 'keyword' },
        conversation_id: { type: 'keyword' },
        account_id: { type: 'keyword' },
        type_user: { type: 'keyword' },
        user: {
          type: 'nested',
          properties: {
            id: { type: 'keyword' },
            name: { type: 'text' },
            photo: { type: 'keyword' },
          },
        },
        content: {
          type: 'nested',
          properties: {
            type: { type: 'keyword' },
            message: {
              type: 'text',
              fields: {
                keyword: {
                  type: 'keyword',
                  ignore_above: 256,
                },
              },
            },
            message_quoted_id: { type: 'keyword' },
            system: { type: 'object', enabled: true },
            quoted: { type: 'object', enabled: true },
            image: { type: 'object', enabled: true },
            video: { type: 'object', enabled: true },
            audio: { type: 'object', enabled: true },
            document: { type: 'object', enabled: true },
            contact: { type: 'object', enabled: true },
            contacts: { type: 'nested', dynamic: true },
            location: { type: 'object', enabled: true },
            reactions: {
              type: 'nested',
              properties: {
                emoji: { type: 'keyword' },
                user_id: { type: 'keyword' },
                user_name: { type: 'text' },
              },
            },
            version: { type: 'nested', dynamic: true },
          },
        },
        deleted: { type: 'boolean' },
        hash: { type: 'keyword' },
        date: { type: 'date' },
      },
    },
  };
};
