import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import {
  normalizeOutboundWebhookChannelIds,
  serializePublicContact,
} from '@core/common/functions/outboundWebhookPayload';
import {
  OutboundWebhookEventService,
  type PreparedOutboundWebhookEvent,
} from '@core/services/outboundWebhookEvent.service';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

@injectable()
export class ContactDeleterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(OutboundWebhookEventService)
    private readonly outboundWebhookEventService: OutboundWebhookEventService | null = null
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    const previousContact =
      await this.contactService.viewContactOutboundWebhookSnapshot(
        contactId,
        accountId
      );

    if (!previousContact) {
      throw new Error(t('contact_not_found'));
    }

    const deletedAt = new Date().toISOString();
    const rawChannelIds = Array.isArray(previousContact.channel_ids)
      ? previousContact.channel_ids.filter(
          (channelId): channelId is string => typeof channelId === 'string'
        )
      : [];
    const channelIds =
      rawChannelIds.length > 0
        ? normalizeOutboundWebhookChannelIds(rawChannelIds)
        : [];
    let preparedEvent: PreparedOutboundWebhookEvent | null = null;
    if (this.outboundWebhookEventService && channelIds.length > 0) {
      preparedEvent = await this.outboundWebhookEventService.prepareBestEffort({
        accountId,
        eventType: 'contact.deleted',
        aggregate: { type: 'contact', id: contactId },
        data: {
          contact: serializePublicContact({
            ...previousContact,
            deleted_at: deletedAt,
          }),
        },
        previous: { contact: serializePublicContact(previousContact) },
        source: webhookSource,
        channelIds,
        actor: actorUserId
          ? { type: 'user', id: actorUserId }
          : { type: 'system' },
        idempotencyKey: `contact-deleted:${contactId}`,
      });
    }

    const deleted = await this.contactService.deleteContactById(
      contactId,
      accountId,
      preparedEvent
    );
    if (!deleted) {
      return false;
    }

    if (preparedEvent && this.outboundWebhookEventService) {
      await this.outboundWebhookEventService.completePersistedBestEffort({
        eventId: preparedEvent.eventId,
        accountId,
      });
    }

    return true;
  }
}
