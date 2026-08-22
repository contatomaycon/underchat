import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';
import type { BulkUpdateContactLabelsRequest } from '@core/schema/contact/bulkUpdateContactLabels/request.schema';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

type BulkLabelOperation = BulkUpdateContactLabelsRequest['operation'];

export interface ContactLabelsBulkUpdateResult {
  processed_count: number;
  changed_count: number;
  failed_count: number;
}

@injectable()
export class ContactLabelsBulkUpdaterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(LabelTemplateService)
    private readonly labelTemplateService: LabelTemplateService,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository
  ) {}

  private async assertLabelsBelongToAccount(
    t: TFunction<'translation', undefined>,
    accountId: string,
    labelTemplateIds: string[]
  ): Promise<void> {
    const accountLabels = await this.labelTemplateService.listLabelTemplateAll(
      accountId
    );
    const accountLabelIds = new Set(
      accountLabels.map((label) => label.label_template_id)
    );

    if (labelTemplateIds.some((labelId) => !accountLabelIds.has(labelId))) {
      throw new Error(t('label_template_not_found'));
    }
  }

  private async updateContactLabels(input: {
    accountId: string;
    actorUserId?: string;
    contactId: string;
    labelTemplateIds: string[];
    operation: BulkLabelOperation;
    webhookSource: OutboundWebhookRequestSource;
  }): Promise<boolean> {
    const contact = await this.contactService.getContactById(
      input.contactId,
      input.accountId
    );
    if (!contact) {
      throw new Error('contact_not_found');
    }

    let changed = false;
    for (const labelTemplateId of input.labelTemplateIds) {
      const assignmentId =
        await this.contactLabelTemplateDeleterRepository.findContactLabelTemplateId(
          input.contactId,
          labelTemplateId,
          input.accountId
        );

      if (input.operation === 'add' && assignmentId) continue;
      if (input.operation === 'remove' && !assignmentId) continue;

      const operationSucceeded =
        input.operation === 'add'
          ? await this.contactService.addContactLabelTemplateIfNotExists(
              input.contactId,
              labelTemplateId,
              input.accountId,
              {
                source: input.webhookSource,
                idempotencyKey: `contact-label-bulk-added:${input.contactId}:${labelTemplateId}`,
                actor: input.actorUserId
                  ? { type: 'user', id: input.actorUserId }
                  : { type: 'system' },
                changes: { added_label_template_id: labelTemplateId },
              }
            )
          : await this.contactService.removeContactLabelTemplate(
              input.contactId,
              labelTemplateId,
              input.accountId,
              {
                source: input.webhookSource,
                idempotencyKey: `contact-label-bulk-removed:${input.contactId}:${labelTemplateId}:${assignmentId}`,
                actor: input.actorUserId
                  ? { type: 'user', id: input.actorUserId }
                  : { type: 'system' },
                changes: { removed_label_template_id: labelTemplateId },
              }
            );

      if (!operationSucceeded) {
        throw new Error('contact_label_template_update_error');
      }
      changed = true;
    }

    return changed;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    body: BulkUpdateContactLabelsRequest,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<ContactLabelsBulkUpdateResult> {
    const contactIds = [...new Set(body.contact_ids)];
    const labelTemplateIds = [...new Set(body.label_template_ids)];
    await this.assertLabelsBelongToAccount(t, accountId, labelTemplateIds);

    const results = await Promise.allSettled(
      contactIds.map(async (contactId) =>
        this.updateContactLabels({
          accountId,
          actorUserId,
          contactId,
          labelTemplateIds,
          operation: body.operation,
          webhookSource,
        })
      )
    );

    const processed = results.filter(
      (result) => result.status === 'fulfilled'
    );
    return {
      processed_count: processed.length,
      changed_count: processed.filter(
        (result) => result.status === 'fulfilled' && result.value
      ).length,
      failed_count: contactIds.length - processed.length,
    };
  }
}
