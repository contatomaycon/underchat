export const notificationMappings = () => {
  return {
    mappings: {
      properties: {
        id: {
          type: 'keyword',
        },
        operation_id: {
          type: 'keyword',
        },
        user_id: {
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
            phone_ddi: {
              type: 'keyword',
            },
            phone_number: {
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
        message_whatsapp: {
          type: 'text',
        },
        message_email: {
          type: 'text',
        },
        email_subject: {
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
        email: {
          type: 'keyword',
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
