import * as dotenv from 'dotenv';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

dotenv.config({
  path: '../../.env',
});

class ValtEnvironment {
  private readonly VAULT_ADDR: string | undefined;
  private readonly VAULT_TOKEN: string | undefined;
  private readonly VAULT_PATCH: string | undefined;
  private readonly VAULT_VERSION: string | undefined;

  constructor() {
    this.VAULT_ADDR = process.env.VAULT_ADDR;
    this.VAULT_TOKEN = process.env.VAULT_TOKEN;
    this.VAULT_PATCH = process.env.VAULT_PATCH;
    this.VAULT_VERSION = process.env.VAULT_VERSION;
  }

  public get vaultAddr(): string {
    if (!this.VAULT_ADDR) {
      throw new InvalidConfigurationError('VAULT_ADDR is not defined.');
    }

    return this.VAULT_ADDR;
  }

  public get vaultToken(): string {
    if (!this.VAULT_TOKEN) {
      throw new InvalidConfigurationError('VAULT_TOKEN is not defined.');
    }

    return this.VAULT_TOKEN;
  }

  public get vaultPatch(): string {
    if (!this.VAULT_PATCH) {
      throw new InvalidConfigurationError('VAULT_PATCH is not defined.');
    }

    return this.VAULT_PATCH;
  }

  public get vaultVersion(): string {
    if (!this.VAULT_VERSION) {
      throw new InvalidConfigurationError('VAULT_VERSION is not defined.');
    }

    return this.VAULT_VERSION;
  }
}

export const valtEnvironment = new ValtEnvironment();
