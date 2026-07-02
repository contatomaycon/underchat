import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ChatService } from '@core/services/chat.service';
import {
  MetaGraphApiError,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';
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

@injectable()
export class WhatsappOfficialHealthViewerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatService)
    private readonly chatService: ChatService,
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

    const [
      openConversations,
      phoneNumbers,
      phoneNumber,
      waba,
      messageAnalytics,
      conversationAnalytics,
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
    ]);

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
      warnings: [],
    };
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
