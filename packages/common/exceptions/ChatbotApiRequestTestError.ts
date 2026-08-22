import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

export type ChatbotApiRequestTestErrorCode =
  | 'chatbot_not_found'
  | 'side_effect_confirmation_required'
  | 'test_rate_limit_exceeded'
  | 'sample_variables_required'
  | 'invalid_api_request'
  | 'api_request_failed';

export class ChatbotApiRequestTestError extends Error {
  constructor(
    public readonly code: ChatbotApiRequestTestErrorCode,
    public readonly httpStatusCode: EHTTPStatusCode,
    message: string
  ) {
    super(message);
    this.name = 'ChatbotApiRequestTestError';
  }
}
