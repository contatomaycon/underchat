import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { generalEnvironment } from '@core/config/environments';

export interface ChatbotApiOutboundHttpPolicy {
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
}

/** Shared transport policy for testing and running Chatbot API nodes. */
export const getChatbotApiOutboundHttpPolicy =
  (): ChatbotApiOutboundHttpPolicy => ({
    isProduction: generalEnvironment.appEnvironment === EAppEnvironment.prod,
    allowLocalhostHttp: generalEnvironment.chatbotApiRequestAllowLocalhostHttp,
  });
