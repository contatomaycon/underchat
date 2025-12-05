import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class AsaasEnvironment {
  public getAsaasHost(): string {
    if (!process.env.ASAAS_HOST) {
      throw new InvalidConfigurationError('ASAAS_HOST');
    }

    return process.env.ASAAS_HOST;
  }

  public getAsaasWalletId(): string {
    if (!process.env.ASAAS_WALLET_ID) {
      throw new InvalidConfigurationError('ASAAS_WALLET_ID');
    }

    return process.env.ASAAS_WALLET_ID;
  }

  public getAsaasToken(): string {
    if (!process.env.ASAAS_TOKEN) {
      throw new InvalidConfigurationError('ASAAS_TOKEN');
    }

    return process.env.ASAAS_TOKEN;
  }
}
