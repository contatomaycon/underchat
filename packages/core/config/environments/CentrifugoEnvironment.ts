import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class CentrifugoEnvironment {
  private readonly CENTRIFUGO_HMAC_SECRET_KEY: string | undefined;
  private readonly CENTRIFUGO_WS_URL: string | undefined;

  constructor() {
    this.CENTRIFUGO_HMAC_SECRET_KEY = process.env.CENTRIFUGO_HMAC_SECRET_KEY;
    this.CENTRIFUGO_WS_URL = process.env.CENTRIFUGO_WS_URL;
  }

  public get centrifugoHmacSecretKey(): string {
    const key = this.CENTRIFUGO_HMAC_SECRET_KEY;

    if (!key) {
      throw new InvalidConfigurationError(
        'CENTRIFUGO_HMAC_SECRET_KEY is not defined.'
      );
    }

    return key;
  }

  public get centrifugoWsUrl(): string {
    const url = this.CENTRIFUGO_WS_URL;

    if (!url) {
      throw new InvalidConfigurationError('CENTRIFUGO_WS_URL is not defined.');
    }

    return url;
  }
}
