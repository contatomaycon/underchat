import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

/** Identifies an attempt to author a protected Underchat flow without access. */
export class ChatbotUnderchatAccessError extends Error {
  public readonly httpStatusCode = EHTTPStatusCode.forbidden;

  constructor(message: string) {
    super(message);
    this.name = 'ChatbotUnderchatAccessError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChatbotUnderchatAccessError);
    }
  }
}
