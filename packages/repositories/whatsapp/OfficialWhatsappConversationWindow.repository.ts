import * as schema from '@core/models';
import { officialWhatsappConversationWindow } from '@core/models';
import { IOfficialWhatsappConversationWindowRecord } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';
import { currentTime } from '@core/common/functions/currentTime';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

interface WindowIdentity {
  accountId: string;
  workerId: string;
  phone: string;
}

interface UpsertInboundInput extends WindowIdentity {
  contactId?: string | null;
  remoteJid?: string | null;
  messageId?: string | null;
  replyToMessageId?: string | null;
  inboundAt: string;
  expiresAt: string;
}

interface RepairInboundTimestampInput extends WindowIdentity {
  expectedMessageId: string;
  inboundAt: string;
  expiresAt: string;
}

type UpsertTemplateSentInput = WindowIdentity & {
  contactId?: string | null;
  remoteJid?: string | null;
  templateMessageId?: string | null;
  sentAt: string;
} & (
    | { phase: 'reservation' }
    | { phase: 'provider_accepted'; providerAcceptedAt: string }
  );

interface RecordOutboundInput extends WindowIdentity {
  contactId?: string | null;
  remoteJid?: string | null;
  messageId?: string | null;
  sentAt: string;
}

interface MarkClosedInput extends WindowIdentity {
  errorCode?: number | null;
  reason: string;
}

interface ClearAwaitingTemplateInput extends WindowIdentity {
  templateMessageIds: readonly string[];
  errorCode?: number | null;
}

interface MarkAwaitingTemplateUncertainInput extends WindowIdentity {
  templateMessageIds: readonly string[];
}

interface ConfirmAwaitingTemplateInput extends WindowIdentity {
  templateMessageIds: readonly string[];
  providerMessageId?: string | null;
  providerAcceptedAt: string;
}

@injectable()
export class OfficialWhatsappConversationWindowRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private phoneCandidates(phone: string): string[] {
    return buildCandidates(phone, { order: 'input_first' });
  }

  private identityWhere(input: WindowIdentity) {
    return and(
      eq(officialWhatsappConversationWindow.account_id, input.accountId),
      eq(officialWhatsappConversationWindow.worker_id, input.workerId),
      inArray(
        officialWhatsappConversationWindow.phone,
        this.phoneCandidates(input.phone)
      )
    );
  }

  private inboundIdentityWhere(input: UpsertInboundInput) {
    const identityClauses = [
      inArray(
        officialWhatsappConversationWindow.phone,
        this.phoneCandidates(input.phone)
      ),
    ];

    if (input.replyToMessageId) {
      identityClauses.push(
        eq(
          officialWhatsappConversationWindow.awaiting_template_message_id,
          input.replyToMessageId
        )
      );
    }

    return and(
      eq(officialWhatsappConversationWindow.account_id, input.accountId),
      eq(officialWhatsappConversationWindow.worker_id, input.workerId),
      or(...identityClauses)
    );
  }

  private selectPreferredRecord(
    records: IOfficialWhatsappConversationWindowRecord[]
  ): IOfficialWhatsappConversationWindowRecord | null {
    if (records.length === 0) {
      return null;
    }

    const latestInboundRecord = this.latestRecordBy(records, 'last_inbound_at');
    const latestTemplateRecord = this.latestRecordBy(
      records,
      'last_template_sent_at'
    );
    const latestServiceWindowRecord = this.latestRecordBy(
      records,
      'service_window_expires_at'
    );
    const latestUpdatedRecord = this.latestRecordBy(records, 'updated_at');
    const latestInboundAt = latestInboundRecord?.last_inbound_at ?? null;
    const latestTemplateAt =
      latestTemplateRecord?.last_template_sent_at ?? null;
    const serviceWindowExpiresAt =
      latestServiceWindowRecord?.service_window_expires_at ?? null;
    const isLatestBusinessEventInbound =
      this.toTimestamp(latestInboundAt) >= this.toTimestamp(latestTemplateAt);
    const baseRecord =
      (isLatestBusinessEventInbound
        ? latestInboundRecord
        : latestTemplateRecord) ??
      latestUpdatedRecord ??
      records[0];
    const hasExplicitLatestClosure =
      latestUpdatedRecord?.closed_reason === 'meta_reengagement' ||
      latestUpdatedRecord?.closed_reason === 'template_failed' ||
      latestUpdatedRecord?.closed_reason === 'template_send_uncertain';
    const doesWindowCoverLatestTemplate =
      !hasExplicitLatestClosure &&
      latestTemplateAt !== null &&
      this.toTimestamp(serviceWindowExpiresAt) >
        this.toTimestamp(latestTemplateAt);

    return {
      ...baseRecord,
      contact_id:
        baseRecord.contact_id ??
        records.find((record) => record.contact_id)?.contact_id ??
        null,
      remote_jid:
        latestInboundRecord?.remote_jid ?? baseRecord.remote_jid ?? null,
      last_inbound_message_id:
        latestInboundRecord?.last_inbound_message_id ?? null,
      last_inbound_at: latestInboundAt,
      service_window_expires_at: serviceWindowExpiresAt,
      last_template_sent_at: latestTemplateAt,
      awaiting_contact_reply_since: doesWindowCoverLatestTemplate
        ? null
        : (latestTemplateRecord?.awaiting_contact_reply_since ?? null),
      awaiting_template_message_id: doesWindowCoverLatestTemplate
        ? null
        : (latestTemplateRecord?.awaiting_template_message_id ?? null),
      last_meta_error_code: doesWindowCoverLatestTemplate
        ? null
        : hasExplicitLatestClosure
          ? (latestUpdatedRecord?.last_meta_error_code ?? null)
          : (baseRecord.last_meta_error_code ?? null),
      closed_reason: doesWindowCoverLatestTemplate
        ? null
        : hasExplicitLatestClosure
          ? (latestUpdatedRecord?.closed_reason ?? null)
          : (baseRecord.closed_reason ?? null),
      updated_at: latestUpdatedRecord?.updated_at ?? baseRecord.updated_at,
    };
  }

  private latestRecordBy(
    records: IOfficialWhatsappConversationWindowRecord[],
    field:
      | 'last_inbound_at'
      | 'last_template_sent_at'
      | 'service_window_expires_at'
      | 'updated_at'
  ): IOfficialWhatsappConversationWindowRecord | null {
    return (
      [...records].sort((left, right) => {
        const timestampDifference =
          this.toTimestamp(right[field]) - this.toTimestamp(left[field]);
        return timestampDifference !== 0
          ? timestampDifference
          : left.official_whatsapp_conversation_window_id.localeCompare(
              right.official_whatsapp_conversation_window_id
            );
      })[0] ?? null
    );
  }

  private toTimestamp(value?: string | null): number {
    if (!value) {
      return Number.NEGATIVE_INFINITY;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
  }

  findByIdentity = async (
    input: WindowIdentity
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    const records =
      await this.dbRo.query.officialWhatsappConversationWindow.findMany({
        where: this.identityWhere(input),
      });

    return this.selectPreferredRecord(
      records as IOfficialWhatsappConversationWindowRecord[]
    );
  };

  findByIdentityStrong = async (
    input: WindowIdentity
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    const records =
      await this.dbRw.query.officialWhatsappConversationWindow.findMany({
        where: this.identityWhere(input),
      });

    return this.selectPreferredRecord(
      records as IOfficialWhatsappConversationWindowRecord[]
    );
  };

  findAwaitingTemplateByIdentityStrong = async (
    input: WindowIdentity
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    const records =
      await this.dbRw.query.officialWhatsappConversationWindow.findMany({
        where: and(
          this.identityWhere(input),
          isNotNull(
            officialWhatsappConversationWindow.awaiting_contact_reply_since
          )
        ),
      });

    return (
      (records as IOfficialWhatsappConversationWindowRecord[]).sort(
        (left, right) => {
          const timestampDifference =
            this.toTimestamp(right.awaiting_contact_reply_since) -
            this.toTimestamp(left.awaiting_contact_reply_since);
          return timestampDifference !== 0
            ? timestampDifference
            : left.official_whatsapp_conversation_window_id.localeCompare(
                right.official_whatsapp_conversation_window_id
              );
        }
      )[0] ?? null
    );
  };

  repairInboundTimestamp = async (
    input: RepairInboundTimestampInput
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    const repaired = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set({
        last_inbound_at: input.inboundAt,
        service_window_expires_at: input.expiresAt,
        updated_at: currentTime(),
      })
      .where(
        and(
          this.identityWhere(input),
          eq(
            officialWhatsappConversationWindow.last_inbound_message_id,
            input.expectedMessageId
          )
        )
      )
      .returning({
        id: officialWhatsappConversationWindow.official_whatsapp_conversation_window_id,
      })
      .execute();

    if (repaired.length === 0) {
      return null;
    }

    return this.findByIdentityStrong(input);
  };

  upsertInbound = async (
    input: UpsertInboundInput
  ): Promise<IOfficialWhatsappConversationWindowRecord> => {
    const now = currentTime();
    const isNewerInbound = sql<boolean>`
      ${officialWhatsappConversationWindow.last_inbound_at} IS NULL
      OR ${officialWhatsappConversationWindow.last_inbound_at} < ${input.inboundAt}
    `;
    const doesWindowCoverPendingTemplate = sql<boolean>`
      ${officialWhatsappConversationWindow.awaiting_contact_reply_since} IS NOT NULL
      AND GREATEST(
        COALESCE(
          ${officialWhatsappConversationWindow.service_window_expires_at},
          '-infinity'::timestamptz
        ),
        ${input.expiresAt}::timestamptz
      ) > ${officialWhatsappConversationWindow.awaiting_contact_reply_since}
    `;
    const inboundUpdate = {
      contact_id: sql<string | null>`COALESCE(
        ${input.contactId ?? null},
        ${officialWhatsappConversationWindow.contact_id}
      )`,
      remote_jid: sql<string | null>`COALESCE(
        ${input.remoteJid ?? null},
        ${officialWhatsappConversationWindow.remote_jid}
      )`,
      last_inbound_message_id: sql<string | null>`CASE
        WHEN ${isNewerInbound} THEN ${input.messageId ?? null}
        ELSE ${officialWhatsappConversationWindow.last_inbound_message_id}
      END`,
      last_inbound_at: sql<string | null>`CASE
        WHEN ${isNewerInbound} THEN ${input.inboundAt}
        ELSE ${officialWhatsappConversationWindow.last_inbound_at}
      END`,
      service_window_expires_at: sql<string | null>`CASE
        WHEN ${isNewerInbound} THEN ${input.expiresAt}
        ELSE ${officialWhatsappConversationWindow.service_window_expires_at}
      END`,
      awaiting_contact_reply_since: sql<string | null>`CASE
        WHEN ${doesWindowCoverPendingTemplate} THEN NULL
        ELSE ${officialWhatsappConversationWindow.awaiting_contact_reply_since}
      END`,
      awaiting_template_message_id: sql<string | null>`CASE
        WHEN ${doesWindowCoverPendingTemplate} THEN NULL
        ELSE ${officialWhatsappConversationWindow.awaiting_template_message_id}
      END`,
      last_meta_error_code: sql<number | null>`CASE
        WHEN ${doesWindowCoverPendingTemplate} THEN NULL
        WHEN ${officialWhatsappConversationWindow.awaiting_contact_reply_since} IS NOT NULL
          THEN ${officialWhatsappConversationWindow.last_meta_error_code}
        WHEN ${isNewerInbound} THEN NULL
        ELSE ${officialWhatsappConversationWindow.last_meta_error_code}
      END`,
      closed_reason: sql<string | null>`CASE
        WHEN ${doesWindowCoverPendingTemplate} THEN NULL
        WHEN ${officialWhatsappConversationWindow.awaiting_contact_reply_since} IS NOT NULL
          THEN ${officialWhatsappConversationWindow.closed_reason}
        WHEN ${isNewerInbound} THEN NULL
        ELSE ${officialWhatsappConversationWindow.closed_reason}
      END`,
      updated_at: now,
    };

    const updatedRecords = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set(inboundUpdate)
      .where(this.inboundIdentityWhere(input))
      .returning()
      .execute();

    const updatedRecord = this.selectPreferredRecord(
      updatedRecords as IOfficialWhatsappConversationWindowRecord[]
    );
    if (updatedRecord) {
      return updatedRecord;
    }

    const [record] = await this.dbRw
      .insert(officialWhatsappConversationWindow)
      .values({
        official_whatsapp_conversation_window_id: uuidv7(),
        account_id: input.accountId,
        worker_id: input.workerId,
        contact_id: input.contactId ?? null,
        phone: input.phone,
        remote_jid: input.remoteJid ?? null,
        last_inbound_message_id: input.messageId ?? null,
        last_inbound_at: input.inboundAt,
        service_window_expires_at: input.expiresAt,
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        last_meta_error_code: null,
        closed_reason: null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          officialWhatsappConversationWindow.account_id,
          officialWhatsappConversationWindow.worker_id,
          officialWhatsappConversationWindow.phone,
        ],
        set: inboundUpdate,
      })
      .returning()
      .execute();

    return record as IOfficialWhatsappConversationWindowRecord;
  };

  upsertTemplateSent = async (
    input: UpsertTemplateSentInput
  ): Promise<IOfficialWhatsappConversationWindowRecord> => {
    const now = currentTime();
    const pendingSince =
      input.phase === 'provider_accepted'
        ? input.providerAcceptedAt
        : input.sentAt;
    const pendingReason =
      input.phase === 'provider_accepted'
        ? 'template_pending'
        : 'template_send_uncertain';
    const isNewerTemplate = sql<boolean>`
      ${officialWhatsappConversationWindow.last_template_sent_at} IS NULL
      OR ${officialWhatsappConversationWindow.last_template_sent_at} < ${input.sentAt}
    `;
    const isSamePendingTemplate =
      input.phase === 'provider_accepted'
        ? sql<boolean>`
            ${officialWhatsappConversationWindow.last_template_sent_at} = ${input.sentAt}
            AND ${officialWhatsappConversationWindow.awaiting_contact_reply_since} IS NOT NULL
            AND ${officialWhatsappConversationWindow.closed_reason} = 'template_pending'
          `
        : sql<boolean>`FALSE`;
    const isSameUncertainProviderAcceptance =
      input.phase === 'provider_accepted'
        ? sql<boolean>`
            ${officialWhatsappConversationWindow.last_template_sent_at} = ${input.sentAt}
            AND ${officialWhatsappConversationWindow.awaiting_contact_reply_since} IS NOT NULL
            AND ${officialWhatsappConversationWindow.closed_reason} = 'template_send_uncertain'
          `
        : sql<boolean>`FALSE`;
    const canApplyTemplate = sql<boolean>`
      (${isNewerTemplate})
      OR (${isSamePendingTemplate})
      OR (${isSameUncertainProviderAcceptance})
    `;
    const hasWindowAtTemplateTime = sql<boolean>`
      ${officialWhatsappConversationWindow.service_window_expires_at} > ${input.sentAt}
    `;
    const templateUpdate = {
      contact_id: sql<string | null>`COALESCE(
        ${input.contactId ?? null},
        ${officialWhatsappConversationWindow.contact_id}
      )`,
      remote_jid: sql<string | null>`COALESCE(
        ${input.remoteJid ?? null},
        ${officialWhatsappConversationWindow.remote_jid}
      )`,
      awaiting_contact_reply_since: sql<string | null>`CASE
        WHEN NOT (${canApplyTemplate})
          THEN ${officialWhatsappConversationWindow.awaiting_contact_reply_since}
        WHEN ${hasWindowAtTemplateTime} THEN NULL
        WHEN ${isSamePendingTemplate}
          THEN ${officialWhatsappConversationWindow.awaiting_contact_reply_since}
        ELSE ${pendingSince}
      END`,
      awaiting_template_message_id: sql<string | null>`CASE
        WHEN NOT (${canApplyTemplate})
          THEN ${officialWhatsappConversationWindow.awaiting_template_message_id}
        WHEN ${hasWindowAtTemplateTime} THEN NULL
        ELSE ${input.templateMessageId ?? null}
      END`,
      last_template_sent_at: sql<string | null>`CASE
        WHEN ${canApplyTemplate} THEN ${input.sentAt}
        ELSE ${officialWhatsappConversationWindow.last_template_sent_at}
      END`,
      last_meta_error_code: sql<number | null>`CASE
        WHEN ${canApplyTemplate} THEN NULL
        ELSE ${officialWhatsappConversationWindow.last_meta_error_code}
      END`,
      closed_reason: sql<string | null>`CASE
        WHEN NOT (${canApplyTemplate})
          THEN ${officialWhatsappConversationWindow.closed_reason}
        WHEN ${hasWindowAtTemplateTime} THEN NULL
        ELSE ${pendingReason}
      END`,
      updated_at: now,
    };

    const updatedRecords = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set(templateUpdate)
      .where(this.identityWhere(input))
      .returning()
      .execute();

    const updatedRecord = this.selectPreferredRecord(
      updatedRecords as IOfficialWhatsappConversationWindowRecord[]
    );
    if (updatedRecord) {
      return updatedRecord;
    }

    const [record] = await this.dbRw
      .insert(officialWhatsappConversationWindow)
      .values({
        official_whatsapp_conversation_window_id: uuidv7(),
        account_id: input.accountId,
        worker_id: input.workerId,
        contact_id: input.contactId ?? null,
        phone: input.phone,
        remote_jid: input.remoteJid ?? null,
        awaiting_contact_reply_since: pendingSince,
        awaiting_template_message_id: input.templateMessageId ?? null,
        last_template_sent_at: input.sentAt,
        last_meta_error_code: null,
        closed_reason: pendingReason,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          officialWhatsappConversationWindow.account_id,
          officialWhatsappConversationWindow.worker_id,
          officialWhatsappConversationWindow.phone,
        ],
        set: templateUpdate,
      })
      .returning()
      .execute();

    return record as IOfficialWhatsappConversationWindowRecord;
  };

  recordOutbound = async (
    input: RecordOutboundInput
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    const now = currentTime();
    const isNewerOutbound = sql<boolean>`
      ${officialWhatsappConversationWindow.last_outbound_at} IS NULL
      OR ${officialWhatsappConversationWindow.last_outbound_at} < ${input.sentAt}
    `;
    const outboundUpdate = {
      contact_id: sql<string | null>`COALESCE(
        ${input.contactId ?? null},
        ${officialWhatsappConversationWindow.contact_id}
      )`,
      remote_jid: sql<string | null>`COALESCE(
        ${input.remoteJid ?? null},
        ${officialWhatsappConversationWindow.remote_jid}
      )`,
      last_outbound_message_id: sql<string | null>`CASE
        WHEN ${isNewerOutbound} THEN ${input.messageId ?? null}
        ELSE ${officialWhatsappConversationWindow.last_outbound_message_id}
      END`,
      last_outbound_at: sql<string | null>`CASE
        WHEN ${isNewerOutbound} THEN ${input.sentAt}
        ELSE ${officialWhatsappConversationWindow.last_outbound_at}
      END`,
      updated_at: now,
    };
    const updatedRecords = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set(outboundUpdate)
      .where(this.identityWhere(input))
      .returning()
      .execute();

    const updatedRecord = this.selectPreferredRecord(
      updatedRecords as IOfficialWhatsappConversationWindowRecord[]
    );
    if (updatedRecord) {
      return updatedRecord;
    }

    const [record] = await this.dbRw
      .insert(officialWhatsappConversationWindow)
      .values({
        official_whatsapp_conversation_window_id: uuidv7(),
        account_id: input.accountId,
        worker_id: input.workerId,
        contact_id: input.contactId ?? null,
        phone: input.phone,
        remote_jid: input.remoteJid ?? null,
        last_outbound_message_id: input.messageId ?? null,
        last_outbound_at: input.sentAt,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          officialWhatsappConversationWindow.account_id,
          officialWhatsappConversationWindow.worker_id,
          officialWhatsappConversationWindow.phone,
        ],
        set: outboundUpdate,
      })
      .returning()
      .execute();

    return (record ?? null) as IOfficialWhatsappConversationWindowRecord | null;
  };

  markClosedByMetaError = async (
    input: MarkClosedInput
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    const now = currentTime();
    const closeUpdate = {
      last_meta_error_code: input.errorCode ?? null,
      closed_reason: input.reason,
      service_window_expires_at: now,
      awaiting_contact_reply_since: null,
      awaiting_template_message_id: null,
      updated_at: now,
    };
    const updatedRecords = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set(closeUpdate)
      .where(this.identityWhere(input))
      .returning()
      .execute();

    const updatedRecord = this.selectPreferredRecord(
      updatedRecords as IOfficialWhatsappConversationWindowRecord[]
    );
    if (updatedRecord) {
      return updatedRecord;
    }

    const [record] = await this.dbRw
      .insert(officialWhatsappConversationWindow)
      .values({
        official_whatsapp_conversation_window_id: uuidv7(),
        account_id: input.accountId,
        worker_id: input.workerId,
        phone: input.phone,
        last_meta_error_code: input.errorCode ?? null,
        closed_reason: input.reason,
        service_window_expires_at: now,
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          officialWhatsappConversationWindow.account_id,
          officialWhatsappConversationWindow.worker_id,
          officialWhatsappConversationWindow.phone,
        ],
        set: closeUpdate,
      })
      .returning()
      .execute();

    return (record ?? null) as IOfficialWhatsappConversationWindowRecord | null;
  };

  clearAwaitingTemplate = async (
    input: ClearAwaitingTemplateInput
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    if (input.templateMessageIds.length === 0) {
      return null;
    }

    const now = currentTime();

    const records = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set({
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        last_meta_error_code: input.errorCode ?? null,
        closed_reason: 'template_failed',
        updated_at: now,
      })
      .where(
        and(
          this.identityWhere(input),
          isNotNull(
            officialWhatsappConversationWindow.awaiting_contact_reply_since
          ),
          inArray(
            officialWhatsappConversationWindow.awaiting_template_message_id,
            [...input.templateMessageIds]
          )
        )
      )
      .returning()
      .execute();

    return this.selectPreferredRecord(
      records as IOfficialWhatsappConversationWindowRecord[]
    );
  };

  markAwaitingTemplateUncertain = async (
    input: MarkAwaitingTemplateUncertainInput
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    if (input.templateMessageIds.length === 0) {
      return null;
    }

    const records = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set({
        last_meta_error_code: null,
        closed_reason: 'template_send_uncertain',
        updated_at: currentTime(),
      })
      .where(
        and(
          this.identityWhere(input),
          isNotNull(
            officialWhatsappConversationWindow.awaiting_contact_reply_since
          ),
          inArray(
            officialWhatsappConversationWindow.awaiting_template_message_id,
            [...input.templateMessageIds]
          )
        )
      )
      .returning()
      .execute();

    return this.selectPreferredRecord(
      records as IOfficialWhatsappConversationWindowRecord[]
    );
  };

  confirmAwaitingTemplate = async (
    input: ConfirmAwaitingTemplateInput
  ): Promise<IOfficialWhatsappConversationWindowRecord | null> => {
    if (input.templateMessageIds.length === 0) {
      return null;
    }

    const records = await this.dbRw
      .update(officialWhatsappConversationWindow)
      .set({
        awaiting_contact_reply_since: sql<string | null>`CASE
          WHEN ${officialWhatsappConversationWindow.closed_reason} = 'template_send_uncertain'
            THEN ${input.providerAcceptedAt}
          ELSE ${officialWhatsappConversationWindow.awaiting_contact_reply_since}
        END`,
        awaiting_template_message_id: sql<string | null>`COALESCE(
          ${input.providerMessageId ?? null},
          ${officialWhatsappConversationWindow.awaiting_template_message_id}
        )`,
        last_meta_error_code: null,
        closed_reason: 'template_pending',
        updated_at: currentTime(),
      })
      .where(
        and(
          this.identityWhere(input),
          isNotNull(
            officialWhatsappConversationWindow.awaiting_contact_reply_since
          ),
          inArray(officialWhatsappConversationWindow.closed_reason, [
            'template_pending',
            'template_send_uncertain',
          ]),
          inArray(
            officialWhatsappConversationWindow.awaiting_template_message_id,
            [...input.templateMessageIds]
          )
        )
      )
      .returning()
      .execute();

    return this.selectPreferredRecord(
      records as IOfficialWhatsappConversationWindowRecord[]
    );
  };
}
