export const notificationMappings = () => {
  return {
    mappings: {
      properties: {
        id: {
          type: 'keyword',
        },
        notification_id: {
          type: 'keyword',
        },
        message_key: {
          type: 'nested',
          properties: {
            remote_jid: {
              type: 'keyword',
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
        notification_type: {
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
        message: {
          type: 'text',
        },
        name: {
          type: 'text',
          fields: {
            keyword: {
              type: 'keyword',
            },
          },
        },
        phone: {
          type: 'keyword',
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
