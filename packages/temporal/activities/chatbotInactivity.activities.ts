import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { injectable } from 'tsyringe';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'node:path';

export interface IChatbotInactivityActivity {
  processScheduledInactivityChecks(): Promise<void>;
}

@injectable()
export class ChatbotInactivityActivity implements IChatbotInactivityActivity {
  private i18nInitialized = false;

  constructor(
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService
  ) {}

  processScheduledInactivityChecks = async (): Promise<void> => {
    await this.ensureI18nInitialized();

    const t = i18next.getFixedT('pt', 'translation');

    await this.chatbotFlowRunnerService.processScheduledInactivityChecks(t);
  };

  private ensureI18nInitialized = async (): Promise<void> => {
    if (this.i18nInitialized && i18next.isInitialized) {
      return;
    }

    const localesPath = path.join(
      __dirname,
      '../../plugins/i18next/locales/{{lng}}/translation.json'
    );

    if (!i18next.isInitialized) {
      await i18next.use(Backend).init({
        fallbackLng: 'pt',
        backend: {
          loadPath: localesPath,
        },
        interpolation: {
          escapeValue: false,
        },
        returnNull: false,
        returnEmptyString: false,
        returnObjects: false,
      });
    }

    this.i18nInitialized = true;
  };
}
