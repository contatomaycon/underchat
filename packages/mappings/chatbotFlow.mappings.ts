export const chatbotFlowMappings = () => {
  return {
    mappings: {
      properties: {
        chatbot_flow_id: {
          type: 'keyword',
        },
        chatbot_configurations_id: {
          type: 'keyword',
        },
        chatbot_id: {
          type: 'keyword',
        },
        account_id: {
          type: 'keyword',
        },
        configurations: {
          type: 'nested',
          properties: {
            inactivity_alert: {
              type: 'nested',
              properties: {
                status: {
                  type: 'keyword',
                },
                quantity: {
                  type: 'integer',
                },
                time: {
                  type: 'integer',
                },
                action: {
                  type: 'keyword',
                },
                redirect_type: {
                  type: 'keyword',
                },
                selected_user: {
                  type: 'keyword',
                },
                selected_sector: {
                  type: 'keyword',
                },
                selected_sector_user: {
                  type: 'keyword',
                },
              },
            },
            redirect_failed_attempts: {
              type: 'nested',
              properties: {
                status: {
                  type: 'keyword',
                },
                quantity: {
                  type: 'integer',
                },
                redirect_type: {
                  type: 'keyword',
                },
                selected_user: {
                  type: 'keyword',
                },
                selected_sector: {
                  type: 'keyword',
                },
                selected_sector_user: {
                  type: 'keyword',
                },
              },
            },
            finish_triggers: {
              type: 'keyword',
            },
            trigger_events: {
              type: 'keyword',
            },
            messages: {
              type: 'nested',
              properties: {
                inactivity_message: {
                  type: 'text',
                },
                invalid_menu_option_message: {
                  type: 'text',
                },
                invalid_satisfaction_option_message: {
                  type: 'text',
                },
                invalid_cpf_message: {
                  type: 'text',
                },
                invalid_cnpj_message: {
                  type: 'text',
                },
                invalid_email_message: {
                  type: 'text',
                },
                service_finished_message: {
                  type: 'text',
                },
                transfer_message_user: {
                  type: 'text',
                },
                transfer_message_sector: {
                  type: 'text',
                },
                transfer_message_sector_user: {
                  type: 'text',
                },
                inactivity_message_enabled: {
                  type: 'boolean',
                },
                invalid_menu_option_message_enabled: {
                  type: 'boolean',
                },
                invalid_satisfaction_option_message_enabled: {
                  type: 'boolean',
                },
                invalid_cpf_message_enabled: {
                  type: 'boolean',
                },
                invalid_cnpj_message_enabled: {
                  type: 'boolean',
                },
                invalid_email_message_enabled: {
                  type: 'boolean',
                },
                service_finished_message_enabled: {
                  type: 'boolean',
                },
                transfer_message_user_enabled: {
                  type: 'boolean',
                },
                transfer_message_sector_enabled: {
                  type: 'boolean',
                },
                transfer_message_sector_user_enabled: {
                  type: 'boolean',
                },
              },
            },
          },
        },
        nodes: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            type: {
              type: 'keyword',
            },
            position: {
              type: 'nested',
              properties: {
                x: {
                  type: 'float',
                },
                y: {
                  type: 'float',
                },
              },
            },
            data: {
              type: 'nested',
              properties: {
                title: {
                  type: 'text',
                },
                message: {
                  type: 'text',
                },
                messageType: {
                  type: 'keyword',
                },
                text: {
                  type: 'text',
                },
                attachmentFile: {
                  type: 'object',
                  enabled: false,
                },
                attachmentUrl: {
                  type: 'keyword',
                },
                attachmentMimetype: {
                  type: 'keyword',
                },
                attachmentDuration: {
                  type: 'integer',
                },
                attachmentWidth: {
                  type: 'integer',
                },
                attachmentHeight: {
                  type: 'integer',
                },
                continueType: {
                  type: 'keyword',
                },
                dataType: {
                  type: 'keyword',
                },
                firstName: {
                  type: 'text',
                },
                lastName: {
                  type: 'text',
                },
                email: {
                  type: 'keyword',
                },
                cpf: {
                  type: 'keyword',
                },
                cnpj: {
                  type: 'keyword',
                },
                redirectType: {
                  type: 'keyword',
                },
                selectedChannel: {
                  type: 'keyword',
                },
                selectedUser: {
                  type: 'keyword',
                },
                selectedSector: {
                  type: 'keyword',
                },
                selectedSectorUser: {
                  type: 'keyword',
                },
                tagType: {
                  type: 'keyword',
                },
                selectedTag: {
                  type: 'keyword',
                },
                selectedAiAgent: {
                  type: 'keyword',
                },
                defaultQuestion: {
                  type: 'text',
                },
                continueMessage: {
                  type: 'text',
                },
                actionAfterInteractions: {
                  type: 'boolean',
                },
                interactionsQuantity: {
                  type: 'integer',
                },
                distributionType: {
                  type: 'keyword',
                },
                distributionHasSector: {
                  type: 'boolean',
                },
                distributionSelectedSector: {
                  type: 'keyword',
                },
                timezone: {
                  type: 'keyword',
                },
                selectedRandomMessage: {
                  type: 'keyword',
                },
                annotation: {
                  type: 'text',
                },
                options: {
                  type: 'nested',
                  properties: {
                    id: {
                      type: 'keyword',
                    },
                    text: {
                      type: 'text',
                    },
                    required: {
                      type: 'boolean',
                    },
                  },
                },
              },
            },
            label: {
              type: 'text',
            },
            draggable: {
              type: 'boolean',
            },
          },
        },
        edges: {
          type: 'nested',
          properties: {
            id: {
              type: 'keyword',
            },
            source: {
              type: 'keyword',
            },
            target: {
              type: 'keyword',
            },
            sourceHandle: {
              type: 'keyword',
            },
            targetHandle: {
              type: 'keyword',
            },
            markerEnd: {
              type: 'object',
              enabled: false,
            },
            style: {
              type: 'object',
              enabled: false,
            },
          },
        },
        created_at: {
          type: 'date',
        },
        updated_at: {
          type: 'date',
        },
      },
    },
  };
};
