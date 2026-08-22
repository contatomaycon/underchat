import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { WorkerService } from '@core/services/worker.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import {
  MetaWhatsappEmbeddedService,
  MetaWhatsappPhoneNumber,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  OfficialWhatsappPhoneAlreadyConnectedError,
  WorkerWhatsappOfficialConnectionRepository,
} from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { ConnectWhatsappOfficialRequest } from '@core/schema/worker/connectWhatsappOfficial/request.schema';
import { ConnectWhatsappOfficialResponse } from '@core/schema/worker/connectWhatsappOfficial/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WhatsappOfficialConnectorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository
  ) {}

  private normalizeNumber(displayPhoneNumber: string | null): string | null {
    const digits = displayPhoneNumber?.replace(/\D/gu, '') ?? '';
    return digits ? digits.slice(0, 20) : null;
  }

  private async resolvePhoneNumber(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
    phoneNumberId?: string;
  }): Promise<MetaWhatsappPhoneNumber> {
    if (input.phoneNumberId) {
      return this.metaWhatsappEmbeddedService.viewPhoneNumber({
        apiVersion: input.apiVersion,
        accessToken: input.accessToken,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
      });
    }

    const phones = await this.metaWhatsappEmbeddedService.listPhoneNumbers({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      wabaId: input.wabaId,
    });

    if (phones.length !== 1) {
      throw new Error('Meta selected WABA does not have exactly one phone');
    }

    return phones[0];
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    input: ConnectWhatsappOfficialRequest
  ): Promise<ConnectWhatsappOfficialResponse> {
    const [worker, activeConnection] = await Promise.all([
      this.workerService.viewWorker(accountId, workerId),
      this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      ),
    ]);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (worker.status?.id === EWorkerStatus.blocked) {
      throw new Error(t('worker_blocked_by_plan'));
    }

    if (worker.type?.id !== EWorkerType.whatsapp) {
      throw new Error(t('whatsapp_official_disconnect_only_official'));
    }

    if (activeConnection) {
      throw new Error(t('whatsapp_official_already_connected'));
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

    let phone;
    try {
      phone = await this.resolvePhoneNumber({
        apiVersion: config.api_version,
        accessToken: token.access_token,
        wabaId: input.waba_id,
        phoneNumberId: input.phone_number_id,
      });
    } catch {
      throw new Error(t('whatsapp_official_phone_not_found'));
    }

    if (input.phone_number_id && phone.id !== input.phone_number_id) {
      throw new Error(t('whatsapp_official_phone_mismatch'));
    }

    const existing =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByPhoneNumberId(
        phone.id
      );

    if (existing) {
      throw new Error(t('whatsapp_official_phone_already_connected'));
    }

    let subscribed;
    try {
      subscribed = await this.metaWhatsappEmbeddedService.subscribeWabaApp({
        apiVersion: config.api_version,
        accessToken: token.access_token,
        wabaId: input.waba_id,
      });
    } catch {
      throw new Error(t('whatsapp_official_webhook_subscription_failed'));
    }

    if (!subscribed) {
      throw new Error(t('whatsapp_official_webhook_subscription_failed'));
    }

    const connectedAt = currentTime();
    const number = this.normalizeNumber(phone.display_phone_number);
    const accessTokenEncrypted = this.passwordEncryptorService.encrypt(
      token.access_token
    );

    let connected: boolean;
    try {
      connected =
        await this.workerWhatsappOfficialConnectionRepository.createForExistingWorker(
          {
            worker_whatsapp_official_connection_id: uuidv7(),
            worker_id: workerId,
            account_id: accountId,
            number,
            connection_date: connectedAt,
            business_id: input.business_id ?? null,
            waba_id: input.waba_id,
            phone_number_id: phone.id,
            display_phone_number: phone.display_phone_number,
            verified_name: phone.verified_name,
            access_token_encrypted: accessTokenEncrypted,
            token_type: token.token_type,
            expires_at: token.expires_at,
            scope: token.scope,
            api_version: config.api_version,
            connected_at: connectedAt,
          }
        );
    } catch (error) {
      if (error instanceof OfficialWhatsappPhoneAlreadyConnectedError) {
        throw new Error(t('whatsapp_official_phone_already_connected'));
      }

      throw error;
    }

    if (!connected) {
      throw new Error(t('whatsapp_official_reconnect_error'));
    }

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.connectionEstablished,
      status: EBaileysConnectionStatus.connected,
      worker_id: workerId,
      worker_name: worker.name,
      account_id: accountId,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.online,
      phone: number ?? undefined,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      provider_state: 'connected',
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(accountId),
      payload
    );

    return {
      worker_id: workerId,
      account_id: accountId,
      server_id: null,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.online,
      number,
      waba_id: input.waba_id,
      phone_number_id: phone.id,
    };
  }
}
