import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class GeneralEnvironment {
  private readonly APP_ENVIRONMENT: string | undefined;
  private readonly APP_URL_PUBLIC: string | undefined;
  private readonly APP_URL_MANAGER: string | undefined;
  private readonly APP_URL_BALANCER: string | undefined;
  private readonly APP_URL_SERVICE: string | undefined;
  private readonly JWT_SECRET: string | undefined;
  private readonly JWT_SECRET_EXPIRES_IN: string | undefined;
  private readonly UPLOAD_LIMIT_IN_BYTES: string | undefined;
  private readonly CRYPTO_KEY_START: string | undefined;
  private readonly CRYPTO_KEY_END: string | undefined;
  private readonly GIT_TOKEN: string | undefined;
  private readonly GIT_REPO: string | undefined;
  private readonly GIT_BRANCH: string | undefined;
  private readonly IP_LATENCY_DNS_IP: string | undefined;

  constructor() {
    this.APP_ENVIRONMENT = process.env.APP_ENVIRONMENT;
    this.APP_URL_PUBLIC = process.env.APP_URL_PUBLIC;
    this.APP_URL_MANAGER = process.env.APP_URL_MANAGER;
    this.APP_URL_BALANCER = process.env.APP_URL_BALANCER;
    this.APP_URL_SERVICE = process.env.APP_URL_SERVICE;
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_SECRET_EXPIRES_IN = process.env.JWT_SECRET_EXPIRES_IN;
    this.UPLOAD_LIMIT_IN_BYTES = process.env.UPLOAD_LIMIT_IN_BYTES;
    this.CRYPTO_KEY_START = process.env.CRYPTO_KEY_START;
    this.CRYPTO_KEY_END = process.env.CRYPTO_KEY_END;
    this.GIT_TOKEN = process.env.GIT_TOKEN;
    this.GIT_REPO = process.env.GIT_REPO;
    this.GIT_BRANCH = process.env.GIT_BRANCH;
    this.IP_LATENCY_DNS_IP = process.env.IP_LATENCY_DNS_IP;
  }

  public get appEnvironment(): EAppEnvironment {
    const env = this.APP_ENVIRONMENT as unknown as EAppEnvironment;
    if (!env) {
      throw new InvalidConfigurationError('APP_ENVIRONMENT is not defined.');
    }

    if (
      env !== EAppEnvironment.local &&
      env !== EAppEnvironment.dev &&
      env !== EAppEnvironment.hmg &&
      env !== EAppEnvironment.prod
    ) {
      throw new InvalidConfigurationError('APP_ENVIRONMENT is not valid.');
    }

    return env;
  }

  public get appUrlPublic(): string {
    const url = this.APP_URL_PUBLIC;
    if (!url) {
      throw new InvalidConfigurationError('APP_URL_PUBLIC is not defined.');
    }

    return url;
  }

  public get appUrlManager(): string {
    const url = this.APP_URL_MANAGER;
    if (!url) {
      throw new InvalidConfigurationError('APP_URL_MANAGER is not defined.');
    }

    return url;
  }

  public get appUrlBalancer(): string {
    const balancerUrl = this.APP_URL_BALANCER;
    if (!balancerUrl) {
      throw new InvalidConfigurationError('APP_URL_BALANCER is not defined.');
    }

    return balancerUrl;
  }

  public get appUrlService(): string {
    const serviceUrl = this.APP_URL_SERVICE;
    if (!serviceUrl) {
      throw new InvalidConfigurationError('APP_URL_SERVICE is not defined.');
    }

    return serviceUrl;
  }

  public get jwtSecret(): string {
    const secret = this.JWT_SECRET;
    if (!secret) {
      throw new InvalidConfigurationError('JWT_SECRET is not defined.');
    }

    return secret;
  }

  public get jwtSecretExpiresIn(): string {
    const expiresIn = this.JWT_SECRET_EXPIRES_IN;
    if (!expiresIn) {
      throw new InvalidConfigurationError(
        'JWT_SECRET_EXPIRES_IN is not defined.'
      );
    }

    return expiresIn;
  }

  public get uploadLimitInBytes(): number {
    const limit = this.UPLOAD_LIMIT_IN_BYTES;
    if (!limit) {
      throw new InvalidConfigurationError(
        'UPLOAD_LIMIT_IN_BYTES is not defined.'
      );
    }

    return Number(limit);
  }

  public get cryptoKeyStart(): string {
    const start = this.CRYPTO_KEY_START;
    if (!start) {
      throw new InvalidConfigurationError('CRYPTO_KEY_START is not defined.');
    }

    return start;
  }

  public get cryptoKeyEnd(): string {
    const end = this.CRYPTO_KEY_END;
    if (!end) {
      throw new InvalidConfigurationError('CRYPTO_KEY_END is not defined.');
    }

    return end;
  }

  public get protocol(): string {
    return this.appEnvironment === EAppEnvironment.local ? 'http' : 'https';
  }

  public get gitToken(): string {
    const token = this.GIT_TOKEN;
    if (!token) {
      throw new InvalidConfigurationError('GIT_TOKEN is not defined.');
    }

    return token;
  }

  public get gitRepo(): string {
    const repo = this.GIT_REPO;
    if (!repo) {
      throw new InvalidConfigurationError('GIT_REPO is not defined.');
    }

    return repo;
  }

  public get gitBranch(): string {
    const branch = this.GIT_BRANCH;
    if (!branch) {
      throw new InvalidConfigurationError('GIT_BRANCH is not defined.');
    }

    return branch;
  }

  public get ipLatencyDnsIp(): string {
    const ip = this.IP_LATENCY_DNS_IP;
    if (!ip) {
      throw new InvalidConfigurationError('IP_LATENCY_DNS_IP is not defined.');
    }

    return ip;
  }
}
