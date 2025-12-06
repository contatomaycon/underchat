import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class SmtpEnvironment {
  public getSmtpServer(): string {
    if (!process.env.SMTP_SERVER) {
      throw new InvalidConfigurationError('SMTP_SERVER');
    }

    return process.env.SMTP_SERVER;
  }

  public getSmtpPort(): number {
    if (!process.env.SMTP_PORT) {
      throw new InvalidConfigurationError('SMTP_PORT');
    }

    return Number(process.env.SMTP_PORT);
  }

  public getSmtpUsername(): string {
    if (!process.env.SMTP_USERNAME) {
      throw new InvalidConfigurationError('SMTP_USERNAME');
    }

    return process.env.SMTP_USERNAME;
  }

  public getSmtpPassword(): string {
    if (!process.env.SMTP_PASSWORD) {
      throw new InvalidConfigurationError('SMTP_PASSWORD');
    }

    return process.env.SMTP_PASSWORD;
  }

  public getSmtpFrom(): string {
    if (!process.env.SMTP_FROM) {
      throw new InvalidConfigurationError('SMTP_FROM');
    }

    return process.env.SMTP_FROM;
  }

  public getSmtpSecure(): boolean {
    const secure = process.env.SMTP_SECURE;
    return secure === 'true';
  }

  public getSmtpTls(): boolean {
    const tls = process.env.SMTP_TLS;
    return tls === 'true' || tls === undefined;
  }
}
