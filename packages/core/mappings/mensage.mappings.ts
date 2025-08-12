export const mensageMappings = () => {
  return {
    mappings: {
      properties: {
        message_id: {
          type: 'keyword',
        },
        chat_id: {
          type: 'keyword',
        },
        message_key: {
          type: 'nested',
          properties: {
            remote_jid: {
              type: 'keyword',
            },
            from_me: {
              type: 'boolean',
            },
            id: {
              type: 'keyword',
            },
            participant: {
              type: 'keyword',
            },
          },
        },
        type_user: {
          type: 'keyword',
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
        content: {
          type: 'nested',
          properties: {
            type: {
              type: 'keyword',
            },
            quoted: {
              type: 'nested',
              properties: {
                key: {
                  type: 'nested',
                  properties: {
                    remote_jid: {
                      type: 'keyword',
                    },
                    from_me: {
                      type: 'boolean',
                    },
                    id: {
                      type: 'keyword',
                    },
                    participant: {
                      type: 'keyword',
                    },
                  },
                },
                message: {
                  type: 'text',
                },
              },
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
            message_quoted_id: {
              type: 'keyword',
            },
            link_preview: {
              type: 'nested',
              properties: {
                'canonical-url': {
                  type: 'keyword',
                },
                'matched-text': {
                  type: 'text',
                },
                title: {
                  type: 'text',
                },
                description: {
                  type: 'text',
                },
                jpegThumbnail: {
                  type: 'binary',
                },
                highQualityThumbnail: {
                  type: 'binary',
                },
                originalThumbnailUrl: {
                  type: 'keyword',
                },
              },
            },
          },
        },
        summary: {
          type: 'nested',
          properties: {
            is_sent: {
              type: 'boolean',
            },
            is_delivered: {
              type: 'boolean',
            },
            is_seen: {
              type: 'boolean',
            },
          },
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
