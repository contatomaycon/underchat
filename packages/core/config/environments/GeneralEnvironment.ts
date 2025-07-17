import * as dotenv from 'dotenv';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';

dotenv.config({
  path: '../../.env',
});

export class GeneralEnvironment {
  private readonly APP_ENVIRONMENT: EAppEnvironment | undefined;
  private readonly APP_URL_PUBLIC: string | undefined;
  private readonly APP_URL_MANAGER: string | undefined;
  private readonly JWT_SECRET: string | undefined;
  private readonly JWT_SECRET_EXPIRES_IN: string | undefined;
  private readonly UPLOAD_LIMIT_IN_BYTES: number | undefined;
  private readonly CRYPTO_KEY_START: string | undefined;
  private readonly CRYPTO_KEY_END: string | undefined;

  constructor() {
    this.APP_ENVIRONMENT = process.env
      .APP_ENVIRONMENT as unknown as EAppEnvironment;
    this.APP_URL_PUBLIC = process.env.APP_URL_PUBLIC;
    this.APP_URL_MANAGER = process.env.APP_URL_MANAGER;
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_SECRET_EXPIRES_IN = process.env.JWT_SECRET_EXPIRES_IN;
    this.UPLOAD_LIMIT_IN_BYTES = process.env.UPLOAD_LIMIT_IN_BYTES
      ? Number(process.env.UPLOAD_LIMIT_IN_BYTES)
      : undefined;
    this.CRYPTO_KEY_START = process.env.CRYPTO_KEY_START;
    this.CRYPTO_KEY_END = process.env.CRYPTO_KEY_END;
  }

  public get appEnvironment(): EAppEnvironment {
    if (!this.APP_ENVIRONMENT) {
      throw new InvalidConfigurationError('APP_ENVIRONMENT is not defined.');
    }

    if (
      this.APP_ENVIRONMENT !== EAppEnvironment.local &&
      this.APP_ENVIRONMENT !== EAppEnvironment.dev &&
      this.APP_ENVIRONMENT !== EAppEnvironment.hmg &&
      this.APP_ENVIRONMENT !== EAppEnvironment.prod
    ) {
      throw new InvalidConfigurationError('APP_ENVIRONMENT is not valid.');
    }

    return this.APP_ENVIRONMENT;
  }

  public get appUrlPublic(): string {
    if (!this.APP_URL_PUBLIC) {
      throw new InvalidConfigurationError('APP_URL_PUBLIC is not defined.');
    }

    return this.APP_URL_PUBLIC;
  }

  public get appUrlManager(): string {
    if (!this.APP_URL_MANAGER) {
      throw new InvalidConfigurationError('APP_URL_MANAGER is not defined.');
    }

    return this.APP_URL_MANAGER;
  }

  public get jwtSecret(): string {
    if (!this.JWT_SECRET) {
      throw new InvalidConfigurationError('JWT_SECRET is not defined.');
    }

    return this.JWT_SECRET;
  }

  public get jwtSecretExpiresIn(): string {
    if (!this.JWT_SECRET_EXPIRES_IN) {
      throw new InvalidConfigurationError(
        'JWT_SECRET_EXPIRES_IN is not defined.'
      );
    }

    return this.JWT_SECRET_EXPIRES_IN;
  }

  public get uploadLimitInBytes(): number {
    if (!this.UPLOAD_LIMIT_IN_BYTES) {
      throw new InvalidConfigurationError(
        'UPLOAD_LIMIT_IN_BYTES is not defined.'
      );
    }

    return this.UPLOAD_LIMIT_IN_BYTES;
  }

  public get cryptoKeyStart(): string {
    if (!this.CRYPTO_KEY_START) {
      throw new InvalidConfigurationError('CRYPTO_KEY_START is not defined.');
    }

    return this.CRYPTO_KEY_START;
  }

  public get cryptoKeyEnd(): string {
    if (!this.CRYPTO_KEY_END) {
      throw new InvalidConfigurationError('CRYPTO_KEY_END is not defined.');
    }

    return this.CRYPTO_KEY_END;
  }

  public get protocol(): string {
    return this.appEnvironment === EAppEnvironment.local ? 'http' : 'https';
  }
}
