import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class CentrifugoEnvironment {
  public get centrifugoHmacSecretKey(): string {
    const key = process.env.CENTRIFUGO_HMAC_SECRET_KEY;

    if (!key) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_HMAC_SECRET_KEY is not defined.'
      );
    }

    return key;
  }

  public get centrifugoWsUrl(): string {
    const url = process.env.CENTRIFUGO_WS_URL;

    if (!url) {
      throw new InvalidConfigurationError('CENTRIFUGO_WS_URL is not defined.');
    }

    return url;
  }

  public get centrifugoHttpApiUrl(): string {
    const url = process.env.CENTRIFUGO_HTTP_API_URL;

    if (!url) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_HTTP_API_URL is not defined.'
      );
    }

    return url;
  }

  public get centrifugoHttpApiKey(): string {
    const key = process.env.CENTRIFUGO_HTTP_API_KEY;

    if (!key) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_HTTP_API_KEY is not defined.'
      );
    }

    return key;
  }
}
