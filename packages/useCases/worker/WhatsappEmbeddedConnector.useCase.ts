import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { AccountService } from '@core/services/account.service';
import { PlanAccountService } from '@core/services/planAccount.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import {
  MetaWhatsappEmbeddedService,
  MetaWhatsappPhoneNumber,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  ICreateWorkerWhatsappOfficialConnectionWithAccessMigrationResult,
  OfficialWhatsappPhoneAlreadyConnectedError,
  WorkerWhatsappOfficialConnectionRepository,
} from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { ConnectWhatsappEmbeddedRequest } from '@core/schema/worker/connectWhatsappEmbedded/request.schema';
import { ConnectWhatsappEmbeddedResponse } from '@core/schema/worker/connectWhatsappEmbedded/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import {
  chatAccountCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { currentTime } from '@core/common/functions/currentTime';
import { createUserAccessScopeCacheKey } from '@core/common/functions/createCacheKey';
import Redis from 'ioredis';

@injectable()
export class WhatsappEmbeddedConnectorUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async synchronizeMigratedUserChannelAccess(
    accountId: string,
    migratedUserChannels: ReadonlyArray<{
      user_id: string;
      channels: ReadonlyArray<{ id: string; name: string }>;
    }>
  ): Promise<void> {
    const migratedUserChannelsById = new Map(
      migratedUserChannels.map((userChannels) => [
        userChannels.user_id,
        userChannels.channels,
      ])
    );

    await Promise.all(
      Array.from(migratedUserChannelsById).map(async ([userId, channels]) => {
        try {
          await this.redis.del(createUserAccessScopeCacheKey(userId));
        } catch {
          // A stale authorization scope expires quickly; connecting a channel
          // must not fail because cache invalidation is temporarily unavailable.
        }

        try {
          await this.centrifugoService.publishSub(
            chatAccountCentrifugo(accountId),
            {
              event: 'user_channels_updated',
              user_id: userId,
              channels,
            }
          );
        } catch {
          // Best effort: a reconnect must not fail after the transaction has
          // committed only because realtime notification is unavailable.
        }
      })
    );
  }

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
    input: ConnectWhatsappEmbeddedRequest
  ): Promise<ConnectWhatsappEmbeddedResponse> {
    await this.validate(t, accountId);

    const name = input.name.trim();
    if (!name) {
      throw new Error(t('worker_name_required'));
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

    const workerId = uuidv7();
    const connectedAt = currentTime();
    const number = this.normalizeNumber(phone.display_phone_number);
    const accessTokenEncrypted = this.passwordEncryptorService.encrypt(
      token.access_token
    );

    let created: ICreateWorkerWhatsappOfficialConnectionWithAccessMigrationResult;
    try {
      created =
        await this.workerWhatsappOfficialConnectionRepository.createWithWorkerAndMigrateChannelAccess(
          {
            worker_whatsapp_official_connection_id: uuidv7(),
            worker_id: workerId,
            account_id: accountId,
            server_id: null,
            worker_status_id: EWorkerStatus.online,
            worker_type_id: EWorkerType.whatsapp,
            name,
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

    await this.synchronizeMigratedUserChannelAccess(
      accountId,
      created.migrated_user_channels
    );

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.connectionEstablished,
      status: EBaileysConnectionStatus.connected,
      worker_id: workerId,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: EWorkerType.whatsapp,
      account_id: accountId,
      worker_name: name,
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
