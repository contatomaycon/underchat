export const scheduleMappings = () => {
  return {
    mappings: {
      properties: {
        id: {
          type: 'keyword',
        },
        schedule_id: {
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
        contact: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
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
            phone_ddi: {
              type: 'keyword',
            },
            phone_partial: {
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
        type: {
          type: 'keyword',
        },
        message: {
          type: 'text',
          fields: {
            keyword: {
              type: 'keyword',
              ignore_above: 256,
            },
          },
        },
        url: {
          type: 'keyword',
        },
        status: {
          type: 'keyword',
        },
        send_date: {
          type: 'date',
        },
        created_at: {
          type: 'date',
        },
        updated_at: {
          type: 'date',
        },
        send_log: {
          type: 'object',
          enabled: false,
        },
      },
    },
  };
};
