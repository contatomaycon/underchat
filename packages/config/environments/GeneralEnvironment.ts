import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';

export class GeneralEnvironment {
  public get appEnvironment(): EAppEnvironment {
    const env = process.env.APP_ENVIRONMENT as unknown as EAppEnvironment;
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
    const url = process.env.APP_URL_PUBLIC;
    if (!url) {
      throw new InvalidConfigurationError('APP_URL_PUBLIC is not defined.');
    }

    return url;
  }

  public get appUrlManager(): string {
    const url = process.env.APP_URL_MANAGER;
    if (!url) {
      throw new InvalidConfigurationError('APP_URL_MANAGER is not defined.');
    }

    return url;
  }

  public get appUrlBalancer(): string {
    const balancerUrl = process.env.APP_URL_BALANCER;
    if (!balancerUrl) {
      throw new InvalidConfigurationError('APP_URL_BALANCER is not defined.');
    }

    return balancerUrl;
  }

  public get appUrlService(): string {
    const serviceUrl = process.env.APP_URL_SERVICE;
    if (!serviceUrl) {
      throw new InvalidConfigurationError('APP_URL_SERVICE is not defined.');
    }

    return serviceUrl;
  }

  public get appUrlSchedule(): string {
    const scheduleUrl = process.env.APP_URL_SCHEDULE;
    if (!scheduleUrl) {
      throw new InvalidConfigurationError('APP_URL_SCHEDULE is not defined.');
    }

    return scheduleUrl;
  }

  public get jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new InvalidConfigurationError('JWT_SECRET is not defined.');
    }

    return secret;
  }

  public get jwtSecretExpiresIn(): string {
    const expiresIn = process.env.JWT_SECRET_EXPIRES_IN;
    if (!expiresIn) {
      throw new InvalidConfigurationError(
        'JWT_SECRET_EXPIRES_IN is not defined.'
      );
    }

    return expiresIn;
  }

  public get uploadLimitInBytes(): number {
    const limit = process.env.UPLOAD_LIMIT_IN_BYTES;
    if (!limit) {
      throw new InvalidConfigurationError(
        'UPLOAD_LIMIT_IN_BYTES is not defined.'
      );
    }

    return Number(limit);
  }

  public get cryptoKeyStart(): string {
    const start = process.env.CRYPTO_KEY_START;
    if (!start) {
      throw new InvalidConfigurationError('CRYPTO_KEY_START is not defined.');
    }

    return start;
  }

  public get cryptoKeyEnd(): string {
    const end = process.env.CRYPTO_KEY_END;
    if (!end) {
      throw new InvalidConfigurationError('CRYPTO_KEY_END is not defined.');
    }

    return end;
  }

  public get protocol(): string {
    return this.appEnvironment === EAppEnvironment.local ? 'http' : 'https';
  }

  public get chatbotApiRequestAllowLocalhostHttp(): boolean {
    const enabled =
      process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP?.trim().toLowerCase() ===
      'true';
    if (!enabled) {
      return false;
    }

    return (
      this.appEnvironment === EAppEnvironment.local ||
      this.appEnvironment === EAppEnvironment.dev
    );
  }

  public get gitRepo(): string {
    const repo = process.env.GIT_REPO;
    if (!repo) {
      throw new InvalidConfigurationError('GIT_REPO is not defined.');
    }

    return repo;
  }

  public get gitToken(): string {
    const token = process.env.GIT_TOKEN;
    if (!token) {
      throw new InvalidConfigurationError('GIT_TOKEN is not defined.');
    }

    return token;
  }

  public get gitBranch(): string {
    const branch = process.env.GIT_BRANCH;
    if (!branch) {
      throw new InvalidConfigurationError('GIT_BRANCH is not defined.');
    }

    return branch;
  }

  public get ipLatencyDnsIp(): string {
    const ip = process.env.IP_LATENCY_DNS_IP;
    if (!ip) {
      throw new InvalidConfigurationError('IP_LATENCY_DNS_IP is not defined.');
    }

    return ip;
  }

  public get automationSendDedupeTtlSeconds(): number {
    const raw = process.env.AUTOMATION_SEND_DEDUPE_TTL_SECONDS;
    if (!raw) {
      return 86400;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 86400;
    }

    return Math.floor(parsed);
  }

  public get publicApiRateLimitPerMinute(): number {
    const raw = process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE?.trim();
    if (!raw) {
      return 120;
    }

    const parsed = Number(raw);
    const normalized = Math.floor(parsed);
    if (!Number.isFinite(parsed) || normalized < 1) {
      throw new InvalidConfigurationError(
        'PUBLIC_API_RATE_LIMIT_PER_MINUTE must be a positive number.'
      );
    }

    return normalized;
  }
}
