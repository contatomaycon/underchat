import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { AccountService } from '@core/services/account.service';
import { PlanAccountService } from '@core/services/planAccount.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { ConnectWhatsappEmbeddedRequest } from '@core/schema/worker/connectWhatsappEmbedded/request.schema';
import { ConnectWhatsappEmbeddedResponse } from '@core/schema/worker/connectWhatsappEmbedded/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class WhatsappEmbeddedConnectorUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
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

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }

    await this.planAccountService.validateCanCreateWorker(t, accountId);
  }

  private async resolveServerId(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
  }): Promise<string> {
    const viewWorkerServer = await this.workerService.viewWorkerServer(
      input.accountId
    );

    if (!viewWorkerServer?.server_id) {
      throw new Error(input.t('worker_server_not_disponible'));
    }

    return viewWorkerServer.server_id;
  }

  private normalizeNumber(displayPhoneNumber: string | null): string | null {
    const digits = displayPhoneNumber?.replace(/\D/gu, '') ?? '';
    return digits ? digits.slice(0, 20) : null;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: ConnectWhatsappEmbeddedRequest
  ): Promise<ConnectWhatsappEmbeddedResponse> {
    await this.validate(t, accountId);

    const name = input.name.trim();
    if (!name) {
      throw new Error(t('worker_name_required'));
    }

    const serverId = await this.resolveServerId({
      t,
      accountId,
    });

    const existing =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByPhoneNumberId(
        input.phone_number_id
      );

    if (existing) {
      throw new Error(t('whatsapp_official_phone_already_connected'));
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
      phone = await this.metaWhatsappEmbeddedService.viewPhoneNumber({
        apiVersion: config.api_version,
        accessToken: token.access_token,
        wabaId: input.waba_id,
        phoneNumberId: input.phone_number_id,
      });
    } catch {
      throw new Error(t('whatsapp_official_phone_not_found'));
    }

    if (phone.id !== input.phone_number_id) {
      throw new Error(t('whatsapp_official_phone_mismatch'));
    }

    const workerId = uuidv7();
    const connectedAt = currentTime();
    const number = this.normalizeNumber(phone.display_phone_number);
    const accessTokenEncrypted = this.passwordEncryptorService.encrypt(
      token.access_token
    );

    await this.workerWhatsappOfficialConnectionRepository.createWithWorker({
      worker_whatsapp_official_connection_id: uuidv7(),
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.whatsapp,
      name,
      number,
      connection_date: connectedAt,
      business_id: input.business_id ?? null,
      waba_id: input.waba_id,
      phone_number_id: input.phone_number_id,
      display_phone_number: phone.display_phone_number,
      verified_name: phone.verified_name,
      access_token_encrypted: accessTokenEncrypted,
      token_type: token.token_type,
      expires_at: token.expires_at,
      scope: token.scope,
      api_version: config.api_version,
      connected_at: connectedAt,
    });

    await Promise.all([
      this.workerConfigService.ensureTypingSimulationDefault(workerId),
      this.workerConfigService.ensureSecurityKeyDefault(workerId),
    ]);

    const payload: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.whatsapp,
      server_id: serverId,
      account_id: accountId,
      name,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(accountId),
      payload
    );

    return {
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.online,
      number,
      waba_id: input.waba_id,
      phone_number_id: input.phone_number_id,
    };
  }
}
