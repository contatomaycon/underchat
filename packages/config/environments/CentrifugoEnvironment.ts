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

  public get centrifugoPublicWsUrl(): string {
    const url =
      process.env.CENTRIFUGO_PUBLIC_WS_URL ?? process.env.CENTRIFUGO_WS_URL;

    if (!url) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_PUBLIC_WS_URL is not defined.'
      );
    }

    return url;
  }

  public get centrifugoPrivateWsUrl(): string {
    const url =
      process.env.CENTRIFUGO_PRIVATE_WS_URL ?? process.env.CENTRIFUGO_WS_URL;

    if (!url) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_PRIVATE_WS_URL is not defined.'
      );
    }

    return url;
  }

  public get centrifugoWsUrl(): string {
    return this.centrifugoPrivateWsUrl;
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
