import { inject, injectable } from 'tsyringe';
import {
  classifyOfficialWhatsappProviderTimestampForEffects,
  resolveOfficialWhatsappEffectMaxAgeMs,
  resolveOfficialWhatsappFutureToleranceMs,
} from '@core/common/functions/officialWhatsappInboundTimestamp';
import { IMetaWhatsappWebhookEvent } from '@core/common/interfaces/IMetaWhatsappWebhookEvent';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { OfficialWhatsappConversationWindowService } from './officialWhatsappConversationWindow.service';

type MetaRecord = Record<string, unknown>;

const OFFICIAL_WHATSAPP_REPLAY_EFFECT_MAX_AGE_MS =
  resolveOfficialWhatsappEffectMaxAgeMs(
    process.env.OFFICIAL_WHATSAPP_REPLAY_EFFECT_MAX_AGE_MS
  );
const OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS =
  resolveOfficialWhatsappFutureToleranceMs(
    process.env.OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS
  );

@injectable()
export class OfficialWhatsappWebhookWindowRecorderService {
  constructor(
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly connectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly windowService: OfficialWhatsappConversationWindowService
  ) {}

  record = async (event: IMetaWhatsappWebhookEvent): Promise<void> => {
    for (const entry of event.payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (this.isEchoField(change.field)) {
          continue;
        }

        const phoneNumberId = change.value?.metadata?.phone_number_id?.trim();
        if (!phoneNumberId || !change.value?.messages?.length) {
          continue;
        }

        const connection =
          await this.connectionRepository.findActiveByPhoneNumberIdWithWorker(
            phoneNumberId
          );
        if (!connection) {
          continue;
        }

        for (const message of change.value.messages) {
          const freshness = classifyOfficialWhatsappProviderTimestampForEffects(
            {
              providerTimestamp: message.timestamp,
              maxAgeMs: OFFICIAL_WHATSAPP_REPLAY_EFFECT_MAX_AGE_MS,
              futureToleranceMs: OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS,
            }
          );
          if (!freshness.accepted || freshness.providerTimestampMs === null) {
            continue;
          }

          const phone = this.onlyDigits(message.from);
          if (!phone) {
            continue;
          }

          const remoteJid = `${phone}@s.whatsapp.net`;
          const messageId = this.nonEmptyString(message.id);
          const context = this.toRecord(message.context);
          await this.windowService.recordInboundMessage({
            accountId: connection.account_id,
            workerId: connection.worker_id,
            phone: remoteJid,
            remoteJid,
            messageId,
            replyToMessageId: this.nonEmptyString(context?.id),
            syncChat: false,
            inboundAt: new Date(freshness.providerTimestampMs).toISOString(),
          });
        }
      }
    }
  };

  private isEchoField(field?: string): boolean {
    return field === 'message_echoes' || field === 'smb_message_echoes';
  }

  private onlyDigits(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\D/gu, '') : '';
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toRecord(value: unknown): MetaRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as MetaRecord)
      : null;
  }
}
