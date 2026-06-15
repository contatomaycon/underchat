import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { resolveScopedEnvValue } from './envScope';

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value;
}

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
      readEnv('CENTRIFUGO_PUBLIC_WS_URL') ?? readEnv('CENTRIFUGO_WS_URL');

    if (!url) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_PUBLIC_WS_URL is not defined.'
      );
    }

    return url;
  }

  public get centrifugoPrivateWsUrl(): string {
    const url =
      readEnv('CENTRIFUGO_PRIVATE_WS_URL') ?? readEnv('CENTRIFUGO_WS_URL');

    if (!url) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_PRIVATE_WS_URL is not defined.'
      );
    }

    return url;
  }

  public get centrifugoWsUrl(): string {
    const url = resolveScopedEnvValue({
      publicKey: 'CENTRIFUGO_PUBLIC_WS_URL',
      privateKey: 'CENTRIFUGO_PRIVATE_WS_URL',
      legacyKey: 'CENTRIFUGO_WS_URL',
    });

    if (!url) {
      throw new InvalidConfigurationError('CENTRIFUGO_WS_URL is not defined.');
    }

    return url;
  }

  public get centrifugoHttpApiUrl(): string {
    const url = resolveScopedEnvValue({
      publicKey: 'CENTRIFUGO_PUBLIC_HTTP_API_URL',
      privateKey: 'CENTRIFUGO_PRIVATE_HTTP_API_URL',
      legacyKey: 'CENTRIFUGO_HTTP_API_URL',
    });

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
