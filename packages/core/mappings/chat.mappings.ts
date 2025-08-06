export const chatMappings = () => {
  return {
    mappings: {
      properties: {
        chat_id: {
          type: 'keyword',
        },
        summary: {
          type: 'nested',
          properties: {
            last_message: {
              type: 'text',
            },
            last_date: {
              type: 'date',
            },
            unread_count: {
              type: 'integer',
            },
          },
        },
        account: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            name: {
              type: 'text',
            },
          },
        },
        worker: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            name: {
              type: 'text',
            },
          },
        },
        sector: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            name: {
              type: 'text',
            },
          },
        },
        user: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            name: {
              type: 'text',
            },
          },
        },
        contact: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            name: {
              type: 'text',
            },
            phone: {
              type: 'keyword',
            },
          },
        },
        photo: {
          type: 'text',
        },
        name: {
          type: 'text',
        },
        phone: {
          type: 'keyword',
        },
        status: {
          type: 'keyword',
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
