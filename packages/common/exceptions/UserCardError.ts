import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

/** Identifies an attempt to tokenize a card that already has an Asaas token. */
export class CreditCardAlreadyTokenizedError extends Error {
  public readonly httpStatusCode = EHTTPStatusCode.conflict;

  constructor() {
    super('Credit card is already tokenized');
    this.name = 'CreditCardAlreadyTokenizedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CreditCardAlreadyTokenizedError);
    }
  }
}

/** Identifies an invalid saved/new credit card selection in checkout. */
export class CreditCardSourceSelectionError extends Error {
  public readonly httpStatusCode = EHTTPStatusCode.bad_request;

  constructor() {
    super('Exactly one credit card source must be selected');
    this.name = 'CreditCardSourceSelectionError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CreditCardSourceSelectionError);
    }
  }
}

/** Prevents callers from distinguishing another user's archived card. */
export class ArchivedUserCardNotFoundError extends Error {
  public readonly httpStatusCode = EHTTPStatusCode.not_found;

  constructor() {
    super('Archived user card was not found');
    this.name = 'ArchivedUserCardNotFoundError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ArchivedUserCardNotFoundError);
    }
  }
}
