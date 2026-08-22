import { inject, injectable } from 'tsyringe';
import type { Transaction } from '@core/common/types/Transaction.type';
import {
  buildOutboundWebhookIdempotencyKey,
  OutboundWebhookEventService,
  type PreparedOutboundWebhookEvent,
} from '@core/services/outboundWebhookEvent.service';
import {
  normalizeOutboundWebhookChannelIds,
  serializePublicContact,
  type OutboundWebhookActor,
} from '@core/common/functions/outboundWebhookPayload';
import {
  type ContactOutboundWebhookMarker,
  lockContactOutboundWebhookSnapshotInTransaction,
  markContactOutboundWebhookAppliedInTransaction,
  viewContactOutboundWebhookSnapshotWithExecutor,
} from '@core/repositories/contact/contactOutboundWebhookOutbox';

export type ContactGroupWebhookOperation = 'created' | 'updated' | 'deleted';

export interface ContactGroupOutboundWebhookBatchEntry {
  contactId: string;
  previousContact: Record<string, unknown>;
  prepared: PreparedOutboundWebhookEvent | null;
  marker: ContactOutboundWebhookMarker | null;
}

export interface ContactGroupOutboundWebhookBatch {
  accountId: string;
  entries: ContactGroupOutboundWebhookBatchEntry[];
}

type ContactGroupOutboundWebhookBatchEntryWithPreparingEvent =
  ContactGroupOutboundWebhookBatchEntry & {
    prepared: PreparedOutboundWebhookEvent & { state: 'preparing' };
  };

const hasPreparingPreparedEvent = (
  entry: ContactGroupOutboundWebhookBatchEntry
): entry is ContactGroupOutboundWebhookBatchEntryWithPreparingEvent =>
  entry.prepared?.state === 'preparing';

interface PrepareContactGroupOutboundWebhookBatchInput {
  tx: Transaction;
  accountId: string;
  actorUserId?: string;
  operationId: string;
  operation: ContactGroupWebhookOperation;
  contactGroupId: string;
  contactGroupName: string;
  affectedContactIds: readonly string[];
  nextMemberIds: ReadonlySet<string>;
}

const contactGroupsOf = (
  contact: Record<string, unknown>
): Array<Record<string, unknown>> =>
  Array.isArray(contact.contact_groups)
    ? contact.contact_groups.filter(
        (group): group is Record<string, unknown> =>
          Boolean(group) && typeof group === 'object' && !Array.isArray(group)
      )
    : [];

/**
 * Coordinates one durable `contact.updated` intent per contact affected by a
 * group mutation. Contact rows are locked in UUID order before any intent or
 * domain write, so concurrent group/contact mutations cannot invert previous
 * and final snapshots or deadlock by acquiring the same contacts differently.
 */
@injectable()
export class ContactGroupOutboundWebhookBatchService {
  constructor(
    @inject(OutboundWebhookEventService)
    private readonly outboundWebhookEventService: OutboundWebhookEventService
  ) {}

  prepareInTransaction = async (
    input: PrepareContactGroupOutboundWebhookBatchInput
  ): Promise<ContactGroupOutboundWebhookBatch> => {
    const contactIds = [...new Set(input.affectedContactIds)].sort((a, b) =>
      a.localeCompare(b)
    );
    const snapshots: Array<{
      contactId: string;
      previousContact: Record<string, unknown>;
    }> = [];

    // Lock every affected aggregate before reading any previous snapshot.
    // Sequential acquisition is intentional: a single pg transaction uses a
    // single connection and stable ordering prevents cross-batch deadlocks.
    for (const contactId of contactIds) {
      await lockContactOutboundWebhookSnapshotInTransaction(
        input.tx,
        contactId,
        null,
        input.accountId
      );
      const previousContact =
        await viewContactOutboundWebhookSnapshotWithExecutor(
          input.tx,
          contactId,
          input.accountId
        );
      if (!previousContact) {
        throw new Error('outbound_webhook_contact_snapshot_not_found');
      }
      snapshots.push({ contactId, previousContact });
    }

    const actor: OutboundWebhookActor = input.actorUserId
      ? { type: 'user', id: input.actorUserId }
      : { type: 'system' };
    const entries: ContactGroupOutboundWebhookBatchEntry[] = [];

    for (const { contactId, previousContact } of snapshots) {
      const groupsWithoutCurrent = contactGroupsOf(previousContact).filter(
        (group) => group.contact_group_id !== input.contactGroupId
      );
      const intendedContact = {
        ...previousContact,
        contact_groups: input.nextMemberIds.has(contactId)
          ? [
              ...groupsWithoutCurrent,
              {
                contact_group_id: input.contactGroupId,
                name: input.contactGroupName,
              },
            ]
          : groupsWithoutCurrent,
      };
      const rawChannelIds = [
        ...(Array.isArray(previousContact.channel_ids)
          ? previousContact.channel_ids
          : []),
        ...(Array.isArray(
          (intendedContact as Record<string, unknown>).channel_ids
        )
          ? ((intendedContact as Record<string, unknown>)
              .channel_ids as unknown[])
          : []),
      ].filter(
        (channelId): channelId is string => typeof channelId === 'string'
      );
      const channelIds =
        rawChannelIds.length > 0
          ? normalizeOutboundWebhookChannelIds(rawChannelIds)
          : [];
      const prepared =
        channelIds.length === 0
          ? null
          : await this.outboundWebhookEventService.prepareBestEffort({
              accountId: input.accountId,
              eventType: 'contact.updated',
              aggregate: { type: 'contact', id: contactId },
              data: {
                contact: serializePublicContact(intendedContact),
                changes: {
                  contact_group_id: input.contactGroupId,
                  contact_group_operation: input.operation,
                },
              },
              previous: {
                contact: serializePublicContact(previousContact),
              },
              source: 'manager_api',
              channelIds,
              actor,
              idempotencyKey: buildOutboundWebhookIdempotencyKey(
                'contact-group-batch',
                input.operation,
                input.operationId,
                input.contactGroupId,
                contactId
              ),
            });
      const marker: ContactOutboundWebhookMarker | null =
        prepared?.state === 'preparing'
          ? {
              eventId: prepared.eventId,
              accountId: input.accountId,
              envelope: prepared.envelope,
            }
          : null;
      entries.push({ contactId, previousContact, prepared, marker });
    }

    return { accountId: input.accountId, entries };
  };

  markAppliedInTransaction = async (
    tx: Transaction,
    batch: ContactGroupOutboundWebhookBatch
  ): Promise<void> => {
    for (const entry of batch.entries) {
      await markContactOutboundWebhookAppliedInTransaction(
        tx,
        entry.contactId,
        entry.marker,
        entry.previousContact
      );
    }
  };

  completePersistedBestEffort = async (
    batch: ContactGroupOutboundWebhookBatch | null
  ): Promise<void> => {
    if (!batch) return;
    await Promise.allSettled(
      batch.entries.filter(hasPreparingPreparedEvent).map((entry) =>
        this.outboundWebhookEventService.completePersistedBestEffort({
          eventId: entry.prepared.eventId,
          accountId: batch.accountId,
        })
      )
    );
  };

  cancelBestEffort = async (
    batch: ContactGroupOutboundWebhookBatch | null
  ): Promise<void> => {
    if (!batch) return;
    await Promise.allSettled(
      batch.entries
        .filter(hasPreparingPreparedEvent)
        .map((entry) =>
          this.outboundWebhookEventService.cancel(entry.prepared.eventId)
        )
    );
  };
}
