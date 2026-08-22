import * as schema from '@core/models';
import {
  contact,
  contactChannel,
  contactDocumentType,
  contactGroup,
  contactGroupAssignment,
  contactLabelTemplate,
  labelTemplate,
  userInfo,
} from '@core/models';
import type { Transaction } from '@core/common/types/Transaction.type';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  serializePublicContact,
  type OutboundWebhookEnvelope,
} from '@core/common/functions/outboundWebhookPayload';
import { markOutboundWebhookDomainAppliedInTransaction } from '@core/common/functions/outboundWebhookTransactionalOutbox';

type ContactDatabaseExecutor = NodePgDatabase<typeof schema> | Transaction;

export interface ContactOutboundWebhookMarker {
  eventId: string;
  accountId: string;
  envelope: OutboundWebhookEnvelope;
}

export async function lockContactOutboundWebhookSnapshotInTransaction(
  tx: Transaction,
  contactId: string,
  marker?: ContactOutboundWebhookMarker | null,
  accountId?: string | null
): Promise<Record<string, unknown> | null> {
  const expectedAccountId = marker?.accountId ?? accountId;
  if (!expectedAccountId) return null;
  if (marker && accountId && marker.accountId !== accountId) {
    throw new Error('outbound_webhook_contact_account_mismatch');
  }

  const locked = await tx
    .select({ contact_id: contact.contact_id })
    .from(contact)
    .where(
      and(
        eq(contact.contact_id, contactId),
        eq(contact.account_id, expectedAccountId),
        isNull(contact.deleted_at)
      )
    )
    .for('update')
    .limit(1)
    .execute();
  if (!locked[0]) {
    throw new Error('outbound_webhook_contact_not_mutable');
  }

  if (!marker || marker.envelope.data.payload_omitted === true) return null;

  return viewContactOutboundWebhookSnapshotWithExecutor(
    tx,
    contactId,
    marker.accountId
  );
}

/**
 * Reads the public contact projection through the supplied writer/transaction
 * executor. Passing the mutation transaction is what freezes the exact E1
 * state before a later contact mutation can overwrite it.
 */
export async function viewContactOutboundWebhookSnapshotWithExecutor(
  executor: ContactDatabaseExecutor,
  contactId: string,
  accountId?: string,
  options: { includeDeleted?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  const baseConditions = [eq(contact.contact_id, contactId)];
  if (!options.includeDeleted) baseConditions.push(isNull(contact.deleted_at));
  if (accountId) baseConditions.push(eq(contact.account_id, accountId));

  const baseRows = await executor
    .select({
      contact_id: contact.contact_id,
      account_id: contact.account_id,
      mutation_revision: sql<string>`${contact}.xmin::text`,
      name: contact.name,
      last_name: contact.last_name,
      email_partial: contact.email_partial,
      phone_ddi: contact.phone_ddi,
      phone_partial: contact.phone_partial,
      nickname: contact.nickname,
      photo: contact.photo,
      birthday: contact.birthday,
      notes: contact.notes,
      document_partial: contact.document_partial,
      contact_document_type_id: contact.contact_document_type_id,
      contact_document_type_name: contactDocumentType.name,
      user_id: contact.user_id,
      responsible_name: userInfo.name,
      responsible_last_name: userInfo.last_name,
      responsible_photo: userInfo.photo,
      ignore: contact.ignore,
      is_valided: contact.is_valided,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
      deleted_at: contact.deleted_at,
    })
    .from(contact)
    .leftJoin(
      contactDocumentType,
      eq(
        contactDocumentType.contact_document_type_id,
        contact.contact_document_type_id
      )
    )
    .leftJoin(
      userInfo,
      and(eq(userInfo.user_id, contact.user_id), isNull(userInfo.deleted_at))
    )
    .where(and(...baseConditions))
    .limit(1)
    .execute();
  const base = baseRows[0];
  if (!base?.account_id) return null;

  const resolvedAccountId = base.account_id;
  // A Drizzle transaction owns a single pg client. Running these in
  // `Promise.all` makes pg execute overlapping queries on that client (already
  // deprecated in pg 8 and rejected by pg 9), so keep the snapshot reads
  // explicitly sequential and portable.
  const labels = await executor
    .select({
      label_template_id: labelTemplate.label_template_id,
      label: labelTemplate.label,
      color: labelTemplate.color,
    })
    .from(contactLabelTemplate)
    .innerJoin(
      labelTemplate,
      eq(
        labelTemplate.label_template_id,
        contactLabelTemplate.label_template_id
      )
    )
    .where(
      and(
        eq(contactLabelTemplate.contact_id, contactId),
        eq(labelTemplate.account_id, resolvedAccountId),
        isNull(labelTemplate.deleted_at)
      )
    )
    .orderBy(labelTemplate.label_template_id)
    .execute();
  const groups = await executor
    .select({
      contact_group_id: contactGroup.contact_group_id,
      name: contactGroup.name,
    })
    .from(contactGroupAssignment)
    .innerJoin(
      contactGroup,
      eq(contactGroup.contact_group_id, contactGroupAssignment.contact_group_id)
    )
    .where(
      and(
        eq(contactGroupAssignment.contact_id, contactId),
        eq(contactGroup.account_id, resolvedAccountId),
        isNull(contactGroup.deleted_at)
      )
    )
    .orderBy(contactGroup.contact_group_id)
    .execute();
  const channels = await executor
    .select({ channel_id: contactChannel.channel_id })
    .from(contactChannel)
    .where(
      and(
        eq(contactChannel.contact_id, contactId),
        eq(contactChannel.account_id, resolvedAccountId)
      )
    )
    .orderBy(contactChannel.channel_id)
    .execute();

  return {
    contact_id: base.contact_id,
    account_id: resolvedAccountId,
    mutation_revision: base.mutation_revision,
    name: base.name,
    last_name: base.last_name,
    email_partial: base.email_partial,
    phone_ddi: base.phone_ddi,
    phone_partial: base.phone_partial,
    nickname: base.nickname,
    photo: base.photo,
    birthday: base.birthday,
    notes: base.notes,
    document_partial: base.document_partial,
    contact_document_type: base.contact_document_type_id
      ? {
          contact_document_type_id: base.contact_document_type_id,
          name: base.contact_document_type_name,
        }
      : null,
    user: base.user_id
      ? {
          user_id: base.user_id,
          name:
            [base.responsible_name, base.responsible_last_name]
              .filter(Boolean)
              .join(' ') || null,
          photo: base.responsible_photo ?? null,
        }
      : null,
    user_id: base.user_id,
    ignore: base.ignore,
    is_valided: base.is_valided,
    label_templates: labels,
    contact_groups: groups,
    channel_ids: channels.map((channel) => channel.channel_id),
    created_at: base.created_at,
    updated_at: base.updated_at,
    deleted_at: base.deleted_at,
  };
}

/**
 * Persists the exact public post-mutation contact envelope in the same
 * PostgreSQL transaction as the domain write. Recovery can then prove E1 even
 * when E2 changes the same contact before the dispatcher scans the journal.
 */
export async function markContactOutboundWebhookAppliedInTransaction(
  tx: Transaction,
  contactId: string,
  marker?: ContactOutboundWebhookMarker | null,
  previousContact?: Record<string, unknown> | null
): Promise<void> {
  if (!marker) return;

  if (marker.envelope.data.payload_omitted === true) {
    await markOutboundWebhookDomainAppliedInTransaction(tx, marker);
    return;
  }

  const canonical = await viewContactOutboundWebhookSnapshotWithExecutor(
    tx,
    contactId,
    marker.accountId,
    { includeDeleted: true }
  );
  if (!canonical) {
    throw new Error('outbound_webhook_contact_snapshot_not_found');
  }

  await markOutboundWebhookDomainAppliedInTransaction(tx, {
    eventId: marker.eventId,
    accountId: marker.accountId,
    envelope: {
      ...marker.envelope,
      data: {
        ...marker.envelope.data,
        contact: serializePublicContact(canonical),
      },
      previous: previousContact
        ? {
            ...(marker.envelope.previous ?? {}),
            contact: serializePublicContact(previousContact),
          }
        : (marker.envelope.previous ?? null),
    },
  });
}
