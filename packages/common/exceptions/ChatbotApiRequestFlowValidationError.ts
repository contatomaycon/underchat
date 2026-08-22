import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

/** Identifies an expected API Request validation failure while saving a flow. */
export class ChatbotApiRequestFlowValidationError extends Error {
  public readonly httpStatusCode = EHTTPStatusCode.bad_request;

  constructor(message: string) {
    super(message);
    this.name = 'ChatbotApiRequestFlowValidationError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChatbotApiRequestFlowValidationError);
    }
  }
}
