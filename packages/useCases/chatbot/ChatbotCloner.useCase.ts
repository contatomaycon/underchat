import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CloneChatbotRequest } from '@core/schema/chatbot/cloneChatbot/request.schema';
import { CloneChatbotResponse } from '@core/schema/chatbot/cloneChatbot/response.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { PlanAccountService } from '@core/services/planAccount.service';
import { ChatbotClonerRepository } from '@core/repositories/chatbot/ChatbotCloner.repository';
import { v7 as uuidv7 } from 'uuid';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { ListChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/listChatbotFlowConfigurations/response.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { hasFullAccess } from '@core/common/functions/hasFullAccess';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { ChatbotUnderchatAccessError } from '@core/common/exceptions/ChatbotUnderchatAccessError';

@injectable()
export class ChatbotClonerUseCase {
  constructor(
    @inject(ChatbotClonerRepository)
    private readonly chatbotClonerRepository: ChatbotClonerRepository,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: CloneChatbotRequest,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const originalChatbot = await this.chatbotClonerRepository.findChatbotById(
      input.chatbot_id,
      accountId
    );
    if (!originalChatbot) {
      throw new Error(t('chatbot_not_found'));
    }

    const nameExists = await this.chatbotService.existsChatbotByName(
      input.name,
      accountId
    );
    if (nameExists) {
      throw new Error(t('chatbot_name_already_exists'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CloneChatbotRequest,
    accountId: string,
    actions: IJwtGroupHierarchy[] = []
  ): Promise<CloneChatbotResponse | null> {
    await this.validate(t, input, accountId);

    const originalFlow = await this.chatbotService.findChatbotFlowByChatbotId(
      accountId,
      input.chatbot_id
    );
    if (
      originalFlow?.nodes.some((node) => node.type === 'underchat') &&
      !hasFullAccess(actions)
    ) {
      throw new ChatbotUnderchatAccessError(t('permission_denied'));
    }

    await this.planAccountService.validateCanCreateChatbot(t, accountId);

    const clonedChatbot = await this.chatbotClonerRepository.cloneChatbot(
      input.chatbot_id,
      input.name,
      accountId
    );

    if (!clonedChatbot) {
      throw new Error(t('chatbot_cloner_error'));
    }

    if (originalFlow) {
      const mappings = chatbotFlowMappings();

      const result = await this.elasticDatabaseService.indices(
        EElasticIndex.chatbot_flow,
        mappings
      );

      if (result) {
        const newFlowId = uuidv7();
        const now = new Date().toISOString();

        const clonedFlow: ListChatbotFlowResponse = {
          chatbot_flow_id: newFlowId,
          chatbot_id: clonedChatbot.chatbot_id,
          account_id: accountId,
          nodes: originalFlow.nodes.map((node) => {
            if (node.type !== 'apiRequest' || !node.data.apiRequest) {
              return node;
            }
            return {
              ...node,
              data: {
                ...node.data,
                apiRequest: {
                  ...node.data.apiRequest,
                  test: {
                    state: 'untested' as const,
                    evidence: null,
                  },
                },
              },
            };
          }),
          edges: originalFlow.edges,
          created_at: now,
          updated_at: now,
        };

        await this.elasticDatabaseService.updateWithOCC(
          EElasticIndex.chatbot_flow,
          newFlowId,
          clonedFlow as Record<string, unknown>,
          {
            upsert: true,
            maxRetries: 5,
          }
        );
      }
    }

    const originalConfigurations =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        accountId,
        input.chatbot_id
      );

    if (originalConfigurations) {
      const mappings = chatbotFlowMappings();

      const result = await this.elasticDatabaseService.indices(
        EElasticIndex.chatbot_flow_configurations,
        mappings
      );

      if (result) {
        const newConfigurationsId = uuidv7();
        const now = new Date().toISOString();

        const clonedConfigurations: ListChatbotFlowConfigurationsResponse = {
          chatbot_configurations_id: newConfigurationsId,
          chatbot_id: clonedChatbot.chatbot_id,
          account_id: accountId,
          configurations: originalConfigurations.configurations,
          created_at: now,
          updated_at: now,
        };

        await this.elasticDatabaseService.updateWithOCC(
          EElasticIndex.chatbot_flow_configurations,
          newConfigurationsId,
          clonedConfigurations as Record<string, unknown>,
          {
            upsert: true,
            maxRetries: 5,
          }
        );
      }
    }

    return clonedChatbot;
  }
}
