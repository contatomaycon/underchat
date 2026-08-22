import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { ContactService } from '@core/services/contact.service';
import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';
import type { BulkUpdateContactDetailsRequest } from '@core/schema/contact/bulkUpdateContactDetails/request.schema';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import type { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';

export interface ContactDetailsBulkUpdateResult {
  processed_count: number;
  changed_count: number;
  failed_count: number;
}

@injectable()
export class ContactDetailsBulkUpdaterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(ContactUpdaterUseCase)
    private readonly contactUpdaterUseCase: ContactUpdaterUseCase
  ) {}

  private async assertResponsibleAttendantBelongsToAccount(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string
  ): Promise<void> {
    const accountUsers = await this.contactService.listContactUsers(accountId);
    if (!accountUsers.some((user) => user.user_id === userId)) {
      throw new Error(t('user_not_found'));
    }
  }

  private async buildContactUpdate(input: {
    accountId: string;
    contactId: string;
    request: BulkUpdateContactDetailsRequest;
    t: TFunction<'translation', undefined>;
  }): Promise<{ body: UpdateContactRequest; changed: boolean }> {
    const { request } = input;
    const contact = await this.contactService.getContactById(
      input.contactId,
      input.accountId
    );
    if (!contact) {
      throw new Error('contact_not_found');
    }

    if (request.operation === 'set_responsible_attendant') {
      return {
        body: { user_id: { value: request.user_id } },
        changed: contact.user?.user_id !== request.user_id,
      };
    }

    if (request.operation === 'remove_responsible_attendant') {
      return {
        body: { user_id: { value: null } },
        changed: Boolean(contact.user?.user_id),
      };
    }

    if (request.operation === 'set_ignore') {
      return {
        body: { ignore: { value: request.ignore } },
        changed:
          (contact.ignore ?? EContactIgnore.not_ignore) !== request.ignore,
      };
    }

    if (request.operation === 'append_notes') {
      const notes = request.notes.trim();
      if (!notes) {
        throw new Error(input.t('contact_update_error'));
      }
      return {
        body: {
          notes: contact.notes?.trim() ? `${contact.notes}\n${notes}` : notes,
        },
        changed: true,
      };
    }

    if (request.operation === 'clear_notes') {
      return {
        body: { notes: '' },
        changed: Boolean(contact.notes?.trim()),
      };
    }

    const currentChannelIds =
      await this.contactService.listContactChannelsByContactId(
        input.accountId,
        input.contactId
      );
    const requestedChannelIds = [...new Set(request.channel_ids)];
    const channelIds =
      request.operation === 'add_channels'
        ? [...new Set([...currentChannelIds, ...requestedChannelIds])]
        : currentChannelIds.filter(
            (channelId) => !requestedChannelIds.includes(channelId)
          );

    return {
      body: { channel_ids: channelIds },
      changed:
        channelIds.length !== currentChannelIds.length ||
        channelIds.some(
          (channelId, index) => channelId !== currentChannelIds[index]
        ),
    };
  }

  private async updateContact(input: {
    accountId: string;
    actorUserId?: string;
    allowedChannelIds: string[];
    contactId: string;
    request: BulkUpdateContactDetailsRequest;
    t: TFunction<'translation', undefined>;
    webhookSource: OutboundWebhookRequestSource;
  }): Promise<boolean> {
    const update = await this.buildContactUpdate(input);
    if (!update.changed) return false;

    return this.contactUpdaterUseCase.execute(
      input.t,
      input.accountId,
      input.contactId,
      update.body,
      input.allowedChannelIds,
      input.actorUserId,
      input.webhookSource
    );
  }

  async execute(input: {
    accountId: string;
    actorUserId?: string;
    allowedChannelIds: string[];
    request: BulkUpdateContactDetailsRequest;
    t: TFunction<'translation', undefined>;
    webhookSource: OutboundWebhookRequestSource;
  }): Promise<ContactDetailsBulkUpdateResult> {
    const contactIds = [...new Set(input.request.contact_ids)];
    if (input.request.operation === 'set_responsible_attendant') {
      await this.assertResponsibleAttendantBelongsToAccount(
        input.t,
        input.accountId,
        input.request.user_id
      );
    }

    const results = await Promise.allSettled(
      contactIds.map((contactId) => this.updateContact({ ...input, contactId }))
    );
    const processed = results.filter((result) => result.status === 'fulfilled');

    return {
      processed_count: processed.length,
      changed_count: processed.filter(
        (result) => result.status === 'fulfilled' && result.value
      ).length,
      failed_count: contactIds.length - processed.length,
    };
  }
}
