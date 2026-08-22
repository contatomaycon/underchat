import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import {
  META_WHATSAPP_REQUIRED_SCOPES,
  MetaGraphApiError,
  MetaWhatsappEmbeddedService,
  isMetaObjectAccessError,
  isMetaPermissionsError,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EnsureWhatsappOfficialWebhookSubscriptionResponse } from '@core/schema/worker/ensureWhatsappOfficialWebhookSubscription/response.schema';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { EnsureWhatsappOfficialWebhookSubscriptionRequest } from '@core/schema/worker/ensureWhatsappOfficialWebhookSubscription/request.schema';

@injectable()
export class WhatsappOfficialWebhookSubscriptionEnsurerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    input: EnsureWhatsappOfficialWebhookSubscriptionRequest
  ): Promise<EnsureWhatsappOfficialWebhookSubscriptionResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (worker.status?.id === EWorkerStatus.blocked) {
      throw new Error(t('worker_blocked_by_plan'));
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

    if (input.waba_id !== connection.waba_id) {
      throw new Error(t('whatsapp_official_waba_mismatch'));
    }

    if (
      input.phone_number_id &&
      input.phone_number_id !== connection.phone_number_id
    ) {
      throw new Error(t('whatsapp_official_phone_mismatch'));
    }

    if (
      connection.business_id &&
      input.business_id &&
      input.business_id !== connection.business_id
    ) {
      throw new Error(t('whatsapp_official_business_mismatch'));
    }

    const config = await this.whatsappEmbeddedService.viewInternalConfig(t);

    let token;
    try {
      token = await this.metaWhatsappEmbeddedService.exchangeCode({
        apiVersion: config.api_version,
        appId: config.app_id,
        appSecret: config.app_secret,
        code: input.code,
      });
    } catch {
      throw new Error(t('whatsapp_official_code_exchange_failed'));
    }

    let subscribed;
    try {
      const tokenDiagnostic =
        await this.metaWhatsappEmbeddedService.debugAccessToken({
          apiVersion: config.api_version,
          accessToken: token.access_token,
          appId: config.app_id,
          appSecret: config.app_secret,
        });
      const grantedScopes = new Set(tokenDiagnostic.scopes);
      const hasRequiredScopes = META_WHATSAPP_REQUIRED_SCOPES.every((scope) =>
        grantedScopes.has(scope)
      );

      if (
        !tokenDiagnostic.is_valid ||
        tokenDiagnostic.app_id !== config.app_id ||
        !hasRequiredScopes
      ) {
        throw new Error('Meta authorization is missing required permissions');
      }

      await this.metaWhatsappEmbeddedService.viewPhoneNumber({
        apiVersion: config.api_version,
        accessToken: token.access_token,
        wabaId: connection.waba_id,
        phoneNumberId: connection.phone_number_id,
      });

      subscribed = await this.metaWhatsappEmbeddedService.subscribeWabaApp({
        apiVersion: config.api_version,
        accessToken: token.access_token,
        wabaId: connection.waba_id,
      });
    } catch (error) {
      console.error('[WhatsappOfficialWebhookSubscriptionEnsurer] failed', {
        error,
        account_id: accountId,
        worker_id: workerId,
        waba_id: connection.waba_id,
        phone_number_id: connection.phone_number_id,
      });

      if (
        isMetaObjectAccessError(error) ||
        isMetaPermissionsError(error) ||
        (error instanceof MetaGraphApiError && error.code === 190) ||
        (error instanceof Error &&
          error.message ===
            'Meta authorization is missing required permissions')
      ) {
        throw new Error(
          t('whatsapp_official_reauthorization_insufficient_permissions')
        );
      }

      throw new Error(t('whatsapp_official_webhook_subscription_failed'));
    }

    if (!subscribed) {
      console.error(
        '[WhatsappOfficialWebhookSubscriptionEnsurer] false result',
        {
          account_id: accountId,
          worker_id: workerId,
          waba_id: connection.waba_id,
          phone_number_id: connection.phone_number_id,
        }
      );
      throw new Error(t('whatsapp_official_webhook_subscription_failed'));
    }

    const authorizationUpdated =
      await this.workerWhatsappOfficialConnectionRepository.updateActiveAuthorization(
        {
          accountId,
          connectionId: connection.worker_whatsapp_official_connection_id,
          workerId,
          businessId: input.business_id ?? connection.business_id,
          accessTokenEncrypted: this.passwordEncryptorService.encrypt(
            token.access_token
          ),
          tokenType: token.token_type,
          expiresAt: token.expires_at,
          scope: token.scope,
          apiVersion: config.api_version,
        }
      );

    if (!authorizationUpdated) {
      throw new Error(t('whatsapp_official_webhook_subscription_failed'));
    }

    const statusReconciled =
      await this.workerWhatsappOfficialConnectionRepository.reconcileActiveWorkerStatus(
        {
          accountId,
          workerId,
        }
      );

    if (statusReconciled) {
      const statusPayload = {
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.online,
      };
      await Promise.allSettled([
        this.centrifugoService.publishSub(
          workerCentrifugoQueue(accountId),
          statusPayload
        ),
        this.centrifugoService.publish(
          channelsConfigCentrifugo(),
          statusPayload
        ),
      ]);
    }

    return {
      worker_id: workerId,
      account_id: accountId,
      waba_id: connection.waba_id,
      phone_number_id: connection.phone_number_id,
      subscribed: true,
    };
  }
}
