import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import {
  IMetaWhatsappWebhookEvent,
  IMetaWhatsappWebhookPayload,
} from '@core/common/interfaces/IMetaWhatsappWebhookEvent';
import { OfficialWhatsappWebhookWindowRecorderService } from '@core/services/officialWhatsappWebhookWindowRecorder.service';

export interface VerifyWhatsappEmbeddedWebhookInput {
  mode?: string;
  verifyToken?: string;
  challenge?: string;
}

export interface ReceiveWhatsappEmbeddedWebhookInput {
  body: unknown;
  rawBody: Buffer;
  signatureHeader?: string | null;
}

export class WhatsappEmbeddedWebhookAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsappEmbeddedWebhookAuthError';
  }
}

@injectable()
export class WhatsappEmbeddedWebhookUseCase {
  constructor(
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(OfficialWhatsappWebhookWindowRecorderService)
    private readonly officialWindowRecorder: OfficialWhatsappWebhookWindowRecorderService
  ) {}

  async verify(
    t: TFunction<'translation', undefined>,
    input: VerifyWhatsappEmbeddedWebhookInput
  ): Promise<string | null> {
    if (input.mode !== 'subscribe' || !input.challenge) {
      return null;
    }

    const config = await this.getSecurityConfig(t);

    return this.safeEquals(input.verifyToken ?? '', config.webhook_verify_token)
      ? input.challenge
      : null;
  }

  async receive(
    t: TFunction<'translation', undefined>,
    input: ReceiveWhatsappEmbeddedWebhookInput
  ): Promise<{ ignored?: boolean }> {
    const config = await this.getSecurityConfig(t);

    if (
      !this.isValidSignature(
        input.rawBody,
        input.signatureHeader,
        config.app_secret
      )
    ) {
      throw new WhatsappEmbeddedWebhookAuthError(
        t('whatsapp_embedded_webhook_signature_invalid')
      );
    }

    const payload = this.normalizePayload(input.body);
    if (payload.object !== 'whatsapp_business_account') {
      return { ignored: true };
    }

    const event: IMetaWhatsappWebhookEvent = {
      received_at: new Date().toISOString(),
      payload,
      raw_body_sha256: createHash('sha256').update(input.rawBody).digest('hex'),
      signature_header: input.signatureHeader ?? null,
    };

    console.log(
      `[WhatsappEmbeddedWebhookUseCase] Received webhook event: ${JSON.stringify(
        event
      )}`
    );

    await this.officialWindowRecorder.record(event);

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.officialWhatsappWebhookEvent(),
      event,
      this.resolveKafkaKey(payload)
    );

    return {};
  }

  private normalizePayload(body: unknown): IMetaWhatsappWebhookPayload {
    return body && typeof body === 'object'
      ? (body as IMetaWhatsappWebhookPayload)
      : {};
  }

  private async getSecurityConfig(t: TFunction<'translation', undefined>) {
    try {
      return await this.whatsappEmbeddedService.viewWebhookSecurityConfig(t);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WhatsappEmbeddedWebhookAuthError(message);
    }
  }

  private resolveKafkaKey(payload: IMetaWhatsappWebhookPayload): string {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id?.trim();
        if (phoneNumberId) {
          return phoneNumberId;
        }
      }

      if (entry.id?.trim()) {
        return entry.id.trim();
      }
    }

    return 'official-whatsapp-webhook';
  }

  private isValidSignature(
    rawBody: Buffer,
    signatureHeader: string | null | undefined,
    appSecret: string
  ): boolean {
    const header = signatureHeader?.trim() ?? '';
    if (!header.startsWith('sha256=')) {
      return false;
    }

    const received = header.slice('sha256='.length);
    if (!/^[a-f0-9]{64}$/iu.test(received)) {
      return false;
    }

    const expected = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return this.safeEquals(received, expected);
  }

  private safeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}
