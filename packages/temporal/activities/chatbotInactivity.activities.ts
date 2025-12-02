import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { container } from 'tsyringe';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

let i18nInitialized = false;

async function ensureI18nInitialized(): Promise<void> {
  if (i18nInitialized && i18next.isInitialized) {
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

  i18nInitialized = true;
}

export interface IChatbotInactivityActivity {
  processScheduledInactivityChecks(): Promise<void>;
}

export async function processScheduledInactivityChecks(): Promise<void> {
  await ensureI18nInitialized();

  const chatbotFlowRunnerService = container.resolve(ChatbotFlowRunnerService);
  const t = i18next.getFixedT('pt', 'translation');

  await chatbotFlowRunnerService.processScheduledInactivityChecks(t);
}
