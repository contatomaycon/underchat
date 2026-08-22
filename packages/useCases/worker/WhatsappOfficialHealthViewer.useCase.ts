import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ChatService } from '@core/services/chat.service';
import {
  META_WHATSAPP_REQUIRED_SCOPES,
  MetaGraphApiError,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  WhatsappOfficialHealthResponse,
  WhatsappOfficialHealthSectionError,
} from '@core/schema/worker/whatsappOfficialHealth/response.schema';
import { EWorkerType } from '@core/common/enums/EWorkerType';

type MetaSection<T> = {
  available: boolean;
  data: T | null;
  error: WhatsappOfficialHealthSectionError | null;
};

type TokenDiagnostic = NonNullable<
  WhatsappOfficialHealthResponse['diagnostics']['token']['data']
>;
type WebhookSubscriptionDiagnostic = NonNullable<
  WhatsappOfficialHealthResponse['diagnostics']['webhook_subscription']['data']
>;

@injectable()
export class WhatsappOfficialHealthViewerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<WhatsappOfficialHealthResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (worker.type?.id !== EWorkerType.whatsapp) {
      throw new Error(t('whatsapp_official_disconnect_only_official'));
    }

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    if (!connection) {
      throw new Error(t('whatsapp_official_connection_not_found'));
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const period = this.createPeriod();
    const embeddedConfig = await this.resolveSection(() =>
      this.whatsappEmbeddedService.viewInternalConfig(t)
    );
    const internalConfig = embeddedConfig.data;

    const [
      openConversations,
      phoneNumbers,
      phoneNumber,
      waba,
      messageAnalytics,
      conversationAnalytics,
      tokenDiagnostic,
      webhookSubscription,
    ] = await Promise.all([
      this.chatService.countOpenChatsByWorkerId(accountId, workerId),
      this.resolveSection(() =>
        this.metaWhatsappEmbeddedService
          .listDetailedPhoneNumbers({
            apiVersion: connection.api_version,
            accessToken,
            wabaId: connection.waba_id,
          })
          .then((results) => ({
            total: results.length,
            results,
          }))
      ),
      this.resolveSection(() =>
        this.metaWhatsappEmbeddedService.viewPhoneNumberHealth({
          apiVersion: connection.api_version,
          accessToken,
          phoneNumberId: connection.phone_number_id,
        })
      ),
      this.resolveSection(() =>
        this.metaWhatsappEmbeddedService.viewWabaHealth({
          apiVersion: connection.api_version,
          accessToken,
          wabaId: connection.waba_id,
        })
      ),
      this.resolveSection(() =>
        this.metaWhatsappEmbeddedService.viewMessageAnalytics({
          apiVersion: connection.api_version,
          accessToken,
          wabaId: connection.waba_id,
          start: period.startUnix,
          end: period.endUnix,
        })
      ),
      this.resolveSection(() =>
        this.metaWhatsappEmbeddedService.viewConversationAnalytics({
          apiVersion: connection.api_version,
          accessToken,
          wabaId: connection.waba_id,
          start: period.startUnix,
          end: period.endUnix,
        })
      ),
      internalConfig
        ? this.resolveSection<TokenDiagnostic>(async () => {
            const token =
              await this.metaWhatsappEmbeddedService.debugAccessToken({
                apiVersion: connection.api_version,
                accessToken,
                appId: internalConfig.app_id,
                appSecret: internalConfig.app_secret,
              });
            const scopes = new Set(token.scopes);
            const requiredScopes = [...META_WHATSAPP_REQUIRED_SCOPES];

            return {
              valid: token.is_valid,
              app_matches_config: token.app_id === internalConfig.app_id,
              type: token.type,
              issued_at: this.unixTimestampToIso(token.issued_at),
              expires_at: this.unixTimestampToIso(token.expires_at),
              data_access_expires_at: this.unixTimestampToIso(
                token.data_access_expires_at
              ),
              does_not_expire:
                token.expires_at === 0 && token.data_access_expires_at === 0,
              scopes: [...scopes].sort(),
              required_scopes: requiredScopes,
              missing_scopes: requiredScopes.filter(
                (scope) => !scopes.has(scope)
              ),
            };
          })
        : this.unavailableSection<TokenDiagnostic>(embeddedConfig.error),
      internalConfig
        ? this.resolveSection<WebhookSubscriptionDiagnostic>(() =>
            this.metaWhatsappEmbeddedService.viewWabaWebhookSubscription({
              apiVersion: connection.api_version,
              accessToken,
              wabaId: connection.waba_id,
              appId: internalConfig.app_id,
            })
          )
        : this.unavailableSection<WebhookSubscriptionDiagnostic>(
            embeddedConfig.error
          ),
    ]);

    const metaSections = [
      phoneNumbers,
      phoneNumber,
      waba,
      messageAnalytics,
      conversationAnalytics,
      tokenDiagnostic,
      webhookSubscription,
    ];
    const hasMetaAccessError = metaSections.some((section) =>
      this.isAuthenticationOrAccessError(section.error)
    );
    const reauthenticationRequired = Boolean(
      hasMetaAccessError ||
      (tokenDiagnostic.data &&
        (!tokenDiagnostic.data.valid ||
          !tokenDiagnostic.data.app_matches_config ||
          tokenDiagnostic.data.missing_scopes.length > 0))
    );
    const warnings = [
      ...(reauthenticationRequired
        ? ['meta_health_warning_reauthentication_required']
        : []),
      ...(webhookSubscription.data?.subscribed === false
        ? ['meta_health_warning_webhook_not_subscribed']
        : []),
      ...(metaSections.some((section) => !section.available)
        ? ['meta_health_warning_partial_data']
        : []),
    ];

    return {
      worker_id: workerId,
      account_id: accountId,
      fetched_at: new Date().toISOString(),
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        days: period.days,
      },
      connection: {
        waba_id: connection.waba_id,
        phone_number_id: connection.phone_number_id,
        api_version: connection.api_version,
      },
      local: {
        open_conversations: openConversations,
      },
      phone_numbers: phoneNumbers,
      phone_number: phoneNumber,
      waba,
      analytics: {
        messages: messageAnalytics,
        conversations: conversationAnalytics,
      },
      diagnostics: {
        reauthentication_required: reauthenticationRequired,
        token: tokenDiagnostic,
        webhook_subscription: webhookSubscription,
      },
      warnings,
    };
  }

  private unavailableSection<T>(
    error: WhatsappOfficialHealthSectionError | null
  ): MetaSection<T> {
    return {
      available: false,
      data: null,
      error: error ?? {
        message: 'Meta Embedded Signup configuration is unavailable',
        type: null,
        code: null,
        error_subcode: null,
      },
    };
  }

  private unixTimestampToIso(value: number | null): string | null {
    if (!value || value <= 0) {
      return null;
    }

    return new Date(value * 1000).toISOString();
  }

  private isAuthenticationOrAccessError(
    error: WhatsappOfficialHealthSectionError | null
  ): boolean {
    if (!error) {
      return false;
    }

    return (
      error.code === 190 ||
      error.code === 200 ||
      (error.code === 100 && error.error_subcode === 33)
    );
  }

  private createPeriod(): {
    start: Date;
    end: Date;
    startUnix: number;
    endUnix: number;
    days: number;
  } {
    const days = 30;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    return {
      start,
      end,
      startUnix: Math.floor(start.getTime() / 1000),
      endUnix: Math.floor(end.getTime() / 1000),
      days,
    };
  }

  private async resolveSection<T>(
    loader: () => Promise<T>
  ): Promise<MetaSection<T>> {
    try {
      return {
        available: true,
        data: await loader(),
        error: null,
      };
    } catch (error) {
      return {
        available: false,
        data: null,
        error: this.toSectionError(error),
      };
    }
  }

  private toSectionError(error: unknown): WhatsappOfficialHealthSectionError {
    if (error instanceof MetaGraphApiError) {
      return {
        message: error.message,
        type: error.type,
        code: error.code,
        error_subcode: error.errorSubcode,
      };
    }

    return {
      message:
        error instanceof Error
          ? error.message
          : 'Meta Graph API request failed',
      type: null,
      code: null,
      error_subcode: null,
    };
  }
}
