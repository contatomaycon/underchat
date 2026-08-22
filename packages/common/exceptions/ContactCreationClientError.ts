import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

type ContactCreationClientStatusCode =
  | EHTTPStatusCode.bad_request
  | EHTTPStatusCode.forbidden
  | EHTTPStatusCode.not_found
  | EHTTPStatusCode.conflict;

/** Identifies an expected client failure while creating a contact. */
export class ContactCreationClientError extends Error {
  public readonly httpStatusCode: ContactCreationClientStatusCode;

  constructor(
    message: string,
    httpStatusCode: ContactCreationClientStatusCode
  ) {
    super(message);
    this.name = 'ContactCreationClientError';
    this.httpStatusCode = httpStatusCode;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ContactCreationClientError);
    }
  }
}
