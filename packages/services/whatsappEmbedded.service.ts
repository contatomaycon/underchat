import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WhatsappEmbeddedConfigRepository } from '@core/repositories/whatsapp/WhatsappEmbeddedConfig.repository';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import { IWhatsappEmbeddedConfigInternal } from '@core/common/interfaces/IWhatsappEmbeddedConfigInternal';
import { ViewWhatsappEmbeddedConfigResponse } from '@core/schema/config/viewWhatsappEmbeddedConfig/response.schema';
import { UpdateWhatsappEmbeddedConfigRequest } from '@core/schema/config/updateWhatsappEmbeddedConfig/request.schema';
import { WorkerWhatsappEmbeddedConfigResponse } from '@core/schema/worker/whatsappEmbeddedConfig/response.schema';

export interface WhatsappEmbeddedInternalConfig {
  app_id: string;
  app_secret: string;
  webhook_verify_token: string | null;
  configuration_id: string;
  api_version: string;
}

export interface WhatsappEmbeddedWebhookSecurityConfig {
  app_secret: string;
  webhook_verify_token: string;
}

@injectable()
export class WhatsappEmbeddedService {
  constructor(
    @inject(WhatsappEmbeddedConfigRepository)
    private readonly whatsappEmbeddedConfigRepository: WhatsappEmbeddedConfigRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private normalizeApiVersion(
    t: TFunction<'translation', undefined>,
    value: string
  ): string {
    const trimmed = value.trim();
    const normalized = trimmed.startsWith('v') ? trimmed : `v${trimmed}`;

    if (!/^v\d+\.\d+$/u.test(normalized)) {
      throw new Error(t('whatsapp_embedded_api_version_invalid'));
    }

    return normalized;
  }

  private isConfigured(
    config: IWhatsappEmbeddedConfigInternal | null
  ): boolean {
    return Boolean(
      config?.app_id?.trim() &&
      config?.app_secret_encrypted?.trim() &&
      config?.configuration_id?.trim() &&
      config?.api_version?.trim()
    );
  }

  private decryptSecret(encrypted: string): string {
    return this.passwordEncryptorService.decrypt(encrypted);
  }

  private decryptOptionalSecret(encrypted?: string | null): string | null {
    if (!encrypted?.trim()) {
      return null;
    }

    return this.passwordEncryptorService.decrypt(encrypted);
  }

  private isWebhookConfigured(
    config: IWhatsappEmbeddedConfigInternal | null
  ): boolean {
    return Boolean(config?.webhook_verify_token_encrypted?.trim());
  }

  async viewConfig(): Promise<ViewWhatsappEmbeddedConfigResponse> {
    const config = await this.whatsappEmbeddedConfigRepository.view();

    return {
      app_id: config?.app_id ?? null,
      configuration_id: config?.configuration_id ?? null,
      api_version: config?.api_version ?? null,
      webhook_verify_token: this.decryptOptionalSecret(
        config?.webhook_verify_token_encrypted
      ),
      has_app_secret: Boolean(config?.app_secret_encrypted?.trim()),
      has_webhook_verify_token: this.isWebhookConfigured(config),
      is_configured: this.isConfigured(config),
      is_webhook_configured: this.isWebhookConfigured(config),
      updated_at: config?.updated_at ?? null,
    };
  }

  async viewPublicConfig(): Promise<WorkerWhatsappEmbeddedConfigResponse> {
    const config = await this.whatsappEmbeddedConfigRepository.view();
    const configured = this.isConfigured(config);

    return {
      app_id: configured ? (config?.app_id ?? null) : null,
      configuration_id: configured ? (config?.configuration_id ?? null) : null,
      api_version: configured ? (config?.api_version ?? null) : null,
      is_configured: configured,
    };
  }

  async viewInternalConfig(
    t: TFunction<'translation', undefined>
  ): Promise<WhatsappEmbeddedInternalConfig> {
    const config = await this.whatsappEmbeddedConfigRepository.view();

    if (!this.isConfigured(config) || !config) {
      throw new Error(t('whatsapp_embedded_config_not_configured'));
    }

    return {
      app_id: config.app_id,
      app_secret: this.decryptSecret(config.app_secret_encrypted),
      webhook_verify_token: this.decryptOptionalSecret(
        config.webhook_verify_token_encrypted
      ),
      configuration_id: config.configuration_id,
      api_version: config.api_version,
    };
  }

  async viewWebhookSecurityConfig(
    t: TFunction<'translation', undefined>
  ): Promise<WhatsappEmbeddedWebhookSecurityConfig> {
    const config = await this.viewInternalConfig(t);

    if (!config.webhook_verify_token?.trim()) {
      throw new Error(t('whatsapp_embedded_webhook_verify_token_required'));
    }

    return {
      app_secret: config.app_secret,
      webhook_verify_token: config.webhook_verify_token,
    };
  }

  async updateConfig(
    t: TFunction<'translation', undefined>,
    input: UpdateWhatsappEmbeddedConfigRequest
  ): Promise<ViewWhatsappEmbeddedConfigResponse> {
    const appId = input.app_id.trim();
    const configurationId = input.configuration_id.trim();
    const rawApiVersion = input.api_version.trim();
    const appSecret = input.app_secret?.trim() ?? '';
    const webhookVerifyToken = input.webhook_verify_token?.trim() ?? '';

    if (!appId) {
      throw new Error(t('whatsapp_embedded_app_id_required'));
    }

    if (!configurationId) {
      throw new Error(t('whatsapp_embedded_configuration_id_required'));
    }

    if (!rawApiVersion) {
      throw new Error(t('whatsapp_embedded_api_version_required'));
    }

    const apiVersion = this.normalizeApiVersion(t, rawApiVersion);

    const current = await this.whatsappEmbeddedConfigRepository.view();

    if (!current?.app_secret_encrypted?.trim() && !appSecret) {
      throw new Error(t('whatsapp_embedded_app_secret_required'));
    }

    const appSecretEncrypted = appSecret
      ? this.passwordEncryptorService.encrypt(appSecret)
      : undefined;
    const webhookVerifyTokenEncrypted =
      input.webhook_verify_token === undefined
        ? undefined
        : webhookVerifyToken
          ? this.passwordEncryptorService.encrypt(webhookVerifyToken)
          : null;

    await this.whatsappEmbeddedConfigRepository.upsert({
      app_id: appId,
      app_secret_encrypted: appSecretEncrypted,
      webhook_verify_token_encrypted: webhookVerifyTokenEncrypted,
      configuration_id: configurationId,
      api_version: apiVersion,
    });

    return this.viewConfig();
  }
}
