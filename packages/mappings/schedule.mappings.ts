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
        attempt_id: {
          type: 'keyword',
        },
        operational_state: {
          type: 'keyword',
        },
        reprocessed_by_message_id: {
          type: 'keyword',
        },
        reprocessed_at: {
          type: 'date',
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
        chatbot_name: {
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
        updated_at_epoch_millis: {
          type: 'long',
        },
        last_event_id: {
          type: 'keyword',
        },
        status_rank: {
          type: 'integer',
        },
        send_log: {
          type: 'object',
          properties: {
            result: {
              type: 'object',
              enabled: false,
            },
            error: {
              type: 'text',
            },
            success: {
              type: 'boolean',
            },
            jid: {
              type: 'keyword',
            },
            payload: {
              type: 'object',
              enabled: false,
            },
          },
        },
      },
    },
  };
};
