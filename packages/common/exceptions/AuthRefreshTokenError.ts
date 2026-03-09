import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

type AuthRefreshTokenErrorStatusCode =
  | EHTTPStatusCode.unauthorized
  | EHTTPStatusCode.forbidden;

export class AuthRefreshTokenError extends Error {
  public readonly httpStatusCode: AuthRefreshTokenErrorStatusCode;

  constructor(
    message: string,
    httpStatusCode: AuthRefreshTokenErrorStatusCode
  ) {
    super(message);
    this.name = 'AuthRefreshTokenError';
    this.httpStatusCode = httpStatusCode;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthRefreshTokenError);
    }
  }
}
