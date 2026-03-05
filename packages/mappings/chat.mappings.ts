export const chatMappings = () => {
  return {
    mappings: {
      properties: {
        chat_id: {
          type: 'keyword',
        },
        message_key: {
          type: 'nested',
          properties: {
            remote_jid: {
              type: 'keyword',
            },
            remote_jid_alt: {
              type: 'keyword',
            },
          },
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
            color: {
              type: 'keyword',
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
            photo: {
              type: 'text',
            },
          },
        },
        secondary_users: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            name: {
              type: 'text',
            },
            photo: {
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
            photo: {
              type: 'keyword',
            },
            responsible_attendant: {
              type: 'nested',
              properties: {
                id: {
                  type: 'keyword',
                },
                name: {
                  type: 'text',
                },
                photo: {
                  type: 'text',
                },
              },
            },
            ignore: {
              type: 'keyword',
            },
          },
        },
        photo: {
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
        status: {
          type: 'keyword',
        },
        date: {
          type: 'date',
        },
        started_at: {
          type: 'date',
        },
        closed_at: {
          type: 'date',
        },
        protocol_ura: {
          type: 'keyword',
        },
        protocol_start: {
          type: 'keyword',
        },
        protocol_transfer: {
          type: 'keyword',
        },
        label: {
          type: 'nested',
          properties: {
            label_template_id: {
              type: 'keyword',
            },
            label: {
              type: 'text',
            },
            color: {
              type: 'keyword',
            },
          },
        },
        embedded_for_ai_agents: {
          type: 'keyword',
        },
        forward_to_output_chatbot: {
          type: 'boolean',
        },
        chatbot_schedule_id: {
          type: 'keyword',
        },
        chatbot_webhook_id: {
          type: 'keyword',
        },
        satisfaction_response: {
          type: 'object',
          properties: {
            question: {
              type: 'text',
            },
            options: {
              properties: {
                id: {
                  type: 'keyword',
                },
                text: {
                  type: 'text',
                },
              },
            },
            response: {
              type: 'object',
              properties: {
                id: {
                  type: 'keyword',
                },
                text: {
                  type: 'text',
                },
              },
            },
          },
        },
      },
    },
  };
};
