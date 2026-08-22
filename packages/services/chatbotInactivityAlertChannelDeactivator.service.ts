import { inject, injectable } from 'tsyringe';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';

@injectable()
export class ChatbotInactivityAlertChannelDeactivatorService {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async deactivateByChannel(
    accountId: string,
    channelId: string
  ): Promise<number> {
    const indexReady = await this.elasticDatabaseService.indices(
      EElasticIndex.chatbot_flow_configurations,
      chatbotFlowMappings()
    );
    if (!indexReady) {
      throw new Error('Failed to prepare chatbot flow configurations index');
    }

    const result = await this.elasticDatabaseService.updateByQueryWithScript(
      EElasticIndex.chatbot_flow_configurations,
      {
        bool: {
          filter: [
            { term: { account_id: accountId } },
            {
              nested: {
                path: 'configurations',
                query: {
                  nested: {
                    path: 'configurations.inactivity_alert',
                    query: {
                      bool: {
                        filter: [
                          {
                            term: {
                              'configurations.inactivity_alert.status':
                                'active',
                            },
                          },
                          {
                            term: {
                              'configurations.inactivity_alert.action':
                                'redirect',
                            },
                          },
                          {
                            term: {
                              'configurations.inactivity_alert.redirect_type':
                                'chatbot',
                            },
                          },
                          {
                            term: {
                              'configurations.inactivity_alert.selected_channel':
                                channelId,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
      {
        source: `
          if (ctx._source.configurations == null ||
              ctx._source.configurations.inactivity_alert == null ||
              ctx._source.configurations.inactivity_alert.status != params.active_status ||
              ctx._source.configurations.inactivity_alert.action != params.redirect_action ||
              ctx._source.configurations.inactivity_alert.redirect_type != params.chatbot_redirect_type ||
              ctx._source.configurations.inactivity_alert.selected_channel != params.channel_id) {
            ctx.op = 'noop';
            return;
          }
          ctx._source.configurations.inactivity_alert.status = params.inactive_status;
          ctx._source.updated_at = params.updated_at;
        `,
        params: {
          active_status: 'active',
          inactive_status: 'inactive',
          redirect_action: 'redirect',
          chatbot_redirect_type: 'chatbot',
          channel_id: channelId,
          updated_at: new Date().toISOString(),
        },
      },
      {
        conflicts: 'abort',
        refresh: true,
        maxRetries: 5,
      }
    );

    return result.updated;
  }
}
