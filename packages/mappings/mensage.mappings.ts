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
            contacts: {
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
            context_info: {
              type: 'nested',
              properties: {
                mentioned_jid: {
                  type: 'keyword',
                },
                group_mentions: {
                  type: 'keyword',
                },
                status_attributions: {
                  type: 'keyword',
                },
                conversion_source: {
                  type: 'keyword',
                },
                conversion_delay_seconds: {
                  type: 'integer',
                },
                external_ad_reply: {
                  type: 'nested',
                  properties: {
                    title: {
                      type: 'text',
                    },
                    media_type: {
                      type: 'integer',
                    },
                    thumbnail_url: {
                      type: 'keyword',
                    },
                    source_type: {
                      type: 'keyword',
                    },
                    source_id: {
                      type: 'keyword',
                    },
                    source_url: {
                      type: 'keyword',
                    },
                    contains_auto_reply: {
                      type: 'boolean',
                    },
                    render_larger_thumbnail: {
                      type: 'boolean',
                    },
                    show_ad_attribution: {
                      type: 'boolean',
                    },
                    ctwa_clid: {
                      type: 'keyword',
                    },
                    click_to_whatsapp_call: {
                      type: 'boolean',
                    },
                    ad_context_preview_dismissed: {
                      type: 'boolean',
                    },
                    source_app: {
                      type: 'keyword',
                    },
                    automated_greeting_message_shown: {
                      type: 'boolean',
                    },
                    greeting_message_body: {
                      type: 'text',
                    },
                    disable_nudge: {
                      type: 'boolean',
                    },
                    original_image_url: {
                      type: 'keyword',
                    },
                    wtwa_ad_format: {
                      type: 'boolean',
                    },
                  },
                },
                entry_point_conversion_source: {
                  type: 'keyword',
                },
                entry_point_conversion_app: {
                  type: 'keyword',
                },
                entry_point_conversion_delay_seconds: {
                  type: 'integer',
                },
                trust_banner_action: {
                  type: 'long',
                },
                ctwa_signals: {
                  type: 'keyword',
                },
                is_forwarded: {
                  type: 'boolean',
                },
                forwarding_score: {
                  type: 'integer',
                },
              },
            },
            template: {
              type: 'nested',
              properties: {
                hydratedTitleText: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                hydratedContentText: {
                  type: 'text',
                },
                hydratedButtons: {
                  type: 'nested',
                  properties: {
                    displayText: {
                      type: 'text',
                      fields: {
                        keyword: {
                          type: 'keyword',
                          ignore_above: 256,
                        },
                      },
                    },
                    id: {
                      type: 'keyword',
                    },
                  },
                },
                templateId: {
                  type: 'keyword',
                },
                verifiedBizName: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
              },
            },
            pin: {
              type: 'nested',
              properties: {
                pin_action: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                pin_user_name: {
                  type: 'text',
                  fields: {
                    keyword: {
                      type: 'keyword',
                      ignore_above: 256,
                    },
                  },
                },
                pin_user_phone: {
                  type: 'keyword',
                },
              },
            },
            ephemeral: {
              type: 'nested',
              properties: {
                enabled: {
                  type: 'boolean',
                },
                expiration_seconds: {
                  type: 'integer',
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
