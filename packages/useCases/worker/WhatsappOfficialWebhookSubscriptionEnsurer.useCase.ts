import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EnsureWhatsappOfficialWebhookSubscriptionResponse } from '@core/schema/worker/ensureWhatsappOfficialWebhookSubscription/response.schema';

@injectable()
export class WhatsappOfficialWebhookSubscriptionEnsurerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<EnsureWhatsappOfficialWebhookSubscriptionResponse> {
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

    let subscribed;
    try {
      subscribed = await this.metaWhatsappEmbeddedService.subscribeWabaApp({
        apiVersion: connection.api_version,
        accessToken,
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

    return {
      worker_id: workerId,
      account_id: accountId,
      waba_id: connection.waba_id,
      phone_number_id: connection.phone_number_id,
      subscribed: true,
    };
  }
}
