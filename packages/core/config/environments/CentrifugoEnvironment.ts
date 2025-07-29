import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

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
}
