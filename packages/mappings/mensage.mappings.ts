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
            remote_jid_alt: {
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
            participant_alt: {
              type: 'keyword',
            },
            addressing_mode: {
              type: 'text',
            },
            is_view_once: {
              type: 'boolean',
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
        deleted: {
          type: 'boolean',
        },
        has_quoted: {
          type: 'boolean',
        },
        content: {
          type: 'nested',
          properties: {
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
            quoted: {
              type: 'nested',
              properties: {
                key: {
                  type: 'nested',
                  properties: {
                    remote_jid: {
                      type: 'keyword',
                    },
                    remote_jid_alt: {
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
                    participant_alt: {
                      type: 'keyword',
                    },
                    addressing_mode: {
                      type: 'text',
                    },
                    is_view_once: {
                      type: 'boolean',
                    },
                  },
                },
                message: {
                  type: 'text',
                },
                type: {
                  type: 'keyword',
                },
                image: {
                  type: 'nested',
                  properties: {
                    url: {
                      type: 'keyword',
                    },
                    caption: {
                      type: 'text',
                      fields: {
                        keyword: {
                          type: 'keyword',
                          ignore_above: 256,
                        },
                      },
                    },
                    mimetype: {
                      type: 'keyword',
                    },
                    extension: {
                      type: 'keyword',
                    },
                    size: {
                      type: 'long',
                    },
                    height: {
                      type: 'integer',
                    },
                    width: {
                      type: 'integer',
                    },
                    thumbnail: {
                      type: 'text',
                    },
                  },
                },
                video: {
                  type: 'nested',
                  properties: {
                    url: {
                      type: 'keyword',
                    },
                    caption: {
                      type: 'text',
                      fields: {
                        keyword: {
                          type: 'keyword',
                          ignore_above: 256,
                        },
                      },
                    },
                    mimetype: {
                      type: 'keyword',
                    },
                    extension: {
                      type: 'keyword',
                    },
                    size: {
                      type: 'long',
                    },
                    duration: {
                      type: 'integer',
                    },
                    height: {
                      type: 'integer',
                    },
                    width: {
                      type: 'integer',
                    },
                    thumbnail: {
                      type: 'text',
                    },
                  },
                },
                document: {
                  type: 'nested',
                  properties: {
                    url: {
                      type: 'keyword',
                    },
                    name: {
                      type: 'text',
                      fields: {
                        keyword: {
                          type: 'keyword',
                          ignore_above: 256,
                        },
                      },
                    },
                    mimetype: {
                      type: 'keyword',
                    },
                    extension: {
                      type: 'keyword',
                    },
                    size: {
                      type: 'long',
                    },
                  },
                },
                audio: {
                  type: 'nested',
                  properties: {
                    url: {
                      type: 'keyword',
                    },
                    name: {
                      type: 'text',
                      fields: {
                        keyword: {
                          type: 'keyword',
                          ignore_above: 256,
                        },
                      },
                    },
                    mimetype: {
                      type: 'keyword',
                    },
                    extension: {
                      type: 'keyword',
                    },
                    size: {
                      type: 'long',
                    },
                    duration: {
                      type: 'integer',
                    },
                    ptt: {
                      type: 'boolean',
                    },
                    view_once: {
                      type: 'boolean',
                    },
                    waveform: {
                      type: 'keyword',
                    },
                  },
                },
                sticker: {
                  type: 'nested',
                  properties: {
                    url: {
                      type: 'keyword',
                    },
                    mimetype: {
                      type: 'keyword',
                    },
                    extension: {
                      type: 'keyword',
                    },
                    size: {
                      type: 'long',
                    },
                    height: {
                      type: 'integer',
                    },
                    width: {
                      type: 'integer',
                    },
                    is_animated: {
                      type: 'boolean',
                    },
                  },
                },
                location: {
                  type: 'nested',
                  properties: {
                    latitude: {
                      type: 'float',
                    },
                    longitude: {
                      type: 'float',
                    },
                    name: {
                      type: 'text',
                    },
                    address: {
                      type: 'text',
                    },
                  },
                },
                contact: {
                  type: 'nested',
                  properties: {
                    contact_id: {
                      type: 'keyword',
                    },
                    name: {
                      type: 'text',
                    },
                    last_name: {
                      type: 'text',
                    },
                    phone: {
                      type: 'keyword',
                    },
                    phone_partial: {
                      type: 'keyword',
                    },
                    phone_ddi: {
                      type: 'keyword',
                    },
                    email: {
                      type: 'keyword',
                    },
                    email_partial: {
                      type: 'keyword',
                    },
                    photo: {
                      type: 'text',
                    },
                  },
                },
              },
            },
            image: {
              type: 'nested',
              properties: {
                url: {
                  type: 'keyword',
                },
                caption: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                mimetype: {
                  type: 'keyword',
                },
                extension: {
                  type: 'keyword',
                },
                size: {
                  type: 'long',
                },
                height: {
                  type: 'integer',
                },
                width: {
                  type: 'integer',
                },
                thumbnail: {
                  type: 'text',
                },
              },
            },
            video: {
              type: 'nested',
              properties: {
                url: {
                  type: 'keyword',
                },
                caption: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                mimetype: {
                  type: 'keyword',
                },
                extension: {
                  type: 'keyword',
                },
                size: {
                  type: 'long',
                },
                duration: {
                  type: 'integer',
                },
                height: {
                  type: 'integer',
                },
                width: {
                  type: 'integer',
                },
                thumbnail: {
                  type: 'text',
                },
              },
            },
            document: {
              type: 'nested',
              properties: {
                url: {
                  type: 'keyword',
                },
                name: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                mimetype: {
                  type: 'keyword',
                },
                extension: {
                  type: 'keyword',
                },
                size: {
                  type: 'long',
                },
              },
            },
            audio: {
              type: 'nested',
              properties: {
                url: {
                  type: 'keyword',
                },
                name: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                mimetype: {
                  type: 'keyword',
                },
                extension: {
                  type: 'keyword',
                },
                size: {
                  type: 'long',
                },
                duration: {
                  type: 'integer',
                },
                ptt: {
                  type: 'boolean',
                },
                view_once: {
                  type: 'boolean',
                },
                waveform: {
                  type: 'keyword',
                },
              },
            },
            sticker: {
              type: 'nested',
              properties: {
                url: {
                  type: 'keyword',
                },
                mimetype: {
                  type: 'keyword',
                },
                extension: {
                  type: 'keyword',
                },
                size: {
                  type: 'long',
                },
                height: {
                  type: 'integer',
                },
                width: {
                  type: 'integer',
                },
                is_animated: {
                  type: 'boolean',
                },
              },
            },
            location: {
              type: 'nested',
              properties: {
                latitude: {
                  type: 'float',
                },
                longitude: {
                  type: 'float',
                },
                name: {
                  type: 'text',
                },
                address: {
                  type: 'text',
                },
              },
            },
            contact: {
              type: 'nested',
              properties: {
                contact_id: {
                  type: 'keyword',
                },
                name: {
                  type: 'text',
                },
                last_name: {
                  type: 'text',
                },
                phone: {
                  type: 'keyword',
                },
                phone_partial: {
                  type: 'keyword',
                },
                phone_ddi: {
                  type: 'keyword',
                },
                email: {
                  type: 'keyword',
                },
                email_partial: {
                  type: 'keyword',
                },
                photo: {
                  type: 'text',
                },
              },
            },
            reactions: {
              type: 'nested',
              properties: {
                emoji: {
                  type: 'keyword',
                },
                user_id: {
                  type: 'keyword',
                },
                user_name: {
                  type: 'text',
                },
              },
            },
            version: {
              type: 'nested',
              properties: {
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
                date: {
                  type: 'date',
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
            is_sent_to_internal: {
              type: 'boolean',
            },
          },
        },
        hash: {
          type: 'keyword',
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
