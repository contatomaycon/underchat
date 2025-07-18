import { injectable } from 'tsyringe';
import Vault from 'node-vault';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { valtEnvironment } from '@core/config/environments/ValtEnvironment';

@injectable()
export class VaultService {
  private client: Vault.client;

  constructor() {
    this.client = Vault({
      apiVersion: 'v1',
      endpoint: valtEnvironment.vaultAddr,
      token: valtEnvironment.vaultToken,
    });
  }

  async getSecret<T = string>(path: string, key: string): Promise<T> {
    const res = await this.client.read(path, {
      version: valtEnvironment.vaultVersion,
    });

    if (!res || !res.data || !(key in res.data)) {
      throw new InvalidConfigurationError(
        `Key "${key}" not found in "${path}"`
      );
    }

    return res.data[key] as T;
  }

  async loadEnv(path: string): Promise<void> {
    const res = await this.client.read(path, {
      version: valtEnvironment.vaultVersion,
    });

    if (!res || !res.data) {
      throw new InvalidConfigurationError(`Secret at "${path}" not found`);
    }

    const data = res.data;

    if (!data?.data) {
      throw new InvalidConfigurationError(
        `No data found in secret at "${path}"`
      );
    }

    Object.entries(data.data).forEach(([k, v]) => {
      process.env[k] = String(v);
    });
  }
}
