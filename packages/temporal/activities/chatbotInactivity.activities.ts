import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { injectable, inject } from 'tsyringe';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';

export interface IChatbotInactivityActivity {
  processScheduledInactivityChecks(): Promise<void>;
}

@injectable()
export class ChatbotInactivityActivity implements IChatbotInactivityActivity {
  constructor(
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService
  ) {}

  processScheduledInactivityChecks = async (): Promise<void> => {
    const t = await createI18nInstance('pt');

    await this.chatbotFlowRunnerService.processScheduledInactivityChecks(t);
  };
}
