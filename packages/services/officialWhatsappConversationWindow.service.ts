import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import {
  IOfficialWhatsappConversationWindowRecord,
  IOfficialWhatsappConversationWindowSnapshot,
} from '@core/common/interfaces/IOfficialWhatsappConversationWindow';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { OfficialWhatsappConversationWindowRepository } from '@core/repositories/whatsapp/OfficialWhatsappConversationWindow.repository';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { CentrifugoService } from './centrifugo.service';
import { ChatService } from './chat.service';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import {
  resolveOfficialWhatsappInboundTimestamp,
  resolveOfficialWhatsappInboundTimestampWithSource,
} from '@core/common/functions/officialWhatsappInboundTimestamp';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';

export interface OfficialWhatsappWindowIdentity {
  accountId: string;
  workerId: string;
  contactId?: string | null;
  phone: string;
  remoteJid?: string | null;
}

interface RecordInboundInput extends OfficialWhatsappWindowIdentity {
  messageId?: string | null;
  replyToMessageId?: string | null;
  inboundAt?: string | Date | null;
  syncChat?: boolean;
}

interface InboundWindowMessageCandidate {
  message_id: string;
  chat_id: string;
  type_user: ETypeUserChat | string;
  date: string;
  account?: { id?: string | null } | null;
  worker?: { id?: string | null } | null;
  phone?: string | null;
  phone_ddi?: string | null;
  message_key?: {
    id?: string | null;
    remote_jid?: string | null;
    remote_jid_alt?: string | null;
    from_me?: boolean | null;
  } | null;
  summary?: {
    is_sent?: boolean | null;
    is_delivered?: boolean | null;
    is_seen?: boolean | null;
    is_sent_to_internal?: boolean | null;
  } | null;
  delivery_status?: string | null;
  provider_error_code?: number | null;
  provider_status_at?: string | null;
  content?: {
    type?: EMessageType | string | null;
    message_quoted_id?: string | null;
    official?: {
      echo?: boolean;
      message_id?: string | null;
      raw?: Record<string, unknown>;
    } | null;
  } | null;
}

interface RecordTemplateInput {
  messageId?: string | null;
  sentAt?: string | Date | null;
}

const CUSTOMER_SERVICE_WINDOW_HOURS = 24;
const OPEN_CHAT_STATUSES = new Set<EChatStatus>([
  EChatStatus.in_chat,
  EChatStatus.queue,
  EChatStatus.ura,
  EChatStatus.ura_output,
  EChatStatus.ura_schedule,
  EChatStatus.ura_webhook,
]);
const OUTBOUND_MESSAGE_TYPE_USERS = new Set<ETypeUserChat>([
  ETypeUserChat.operator,
  ETypeUserChat.bot,
  ETypeUserChat.system,
]);

@injectable()
export class OfficialWhatsappConversationWindowService {
  constructor(
    @inject(OfficialWhatsappConversationWindowRepository)
    private readonly repository: OfficialWhatsappConversationWindowRepository,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  hydrateChat = async (chat: IChat | null): Promise<IChat | null> => {
    if (!chat || !this.isOfficialChat(chat)) {
      return chat;
    }

    return {
      ...chat,
      official_window: await this.resolveForChat(chat),
    };
  };

  hydrateChats = async <T extends IChat>(chats: T[]): Promise<T[]> => {
    return Promise.all(
      chats.map(async (chat) => (await this.hydrateChat(chat)) as T)
    );
  };

  resolveForChat = async (
    chat: IChat,
    now = new Date()
  ): Promise<IOfficialWhatsappConversationWindowSnapshot> => {
    const identity = this.identityFromChat(chat);
    if (!identity) {
      return this.toSnapshot(null, now);
    }

    const record = await this.repository.findByIdentity(identity);
    return this.reconcilePendingWindow({
      chat,
      identity,
      snapshot: this.toSnapshot(record, now),
      now,
      repairAliases: Boolean(record?.awaiting_contact_reply_since),
    });
  };

  resolveForIdentity = async (
    input: OfficialWhatsappWindowIdentity,
    now = new Date(),
    options: { strong?: boolean } = {}
  ): Promise<IOfficialWhatsappConversationWindowSnapshot> => {
    const identity = this.normalizeIdentity(input);
    if (!identity) {
      return this.toSnapshot(null, now);
    }

    const record = options.strong
      ? await this.repository.findByIdentityStrong(identity)
      : await this.repository.findByIdentity(identity);
    return this.toSnapshot(record, now);
  };

  resolveAuthoritativeForChat = async (
    chat: IChat,
    now = new Date()
  ): Promise<IOfficialWhatsappConversationWindowSnapshot> => {
    const identity = this.identityFromChat(chat);
    if (!identity) {
      return this.toSnapshot(null, now);
    }

    const record = await this.repository.findByIdentityStrong(identity);
    return this.reconcilePendingWindow({
      chat,
      identity,
      record,
      snapshot: this.toSnapshot(record, now),
      now,
      repairAliases: true,
      repairHistory: true,
      snapshotIsStrong: true,
    });
  };

  resolveAuthoritativeForIdentity = async (
    input: OfficialWhatsappWindowIdentity,
    now = new Date()
  ): Promise<IOfficialWhatsappConversationWindowSnapshot> => {
    const identity = this.normalizeIdentity(input);
    if (!identity) {
      return this.toSnapshot(null, now);
    }

    const record = await this.repository.findByIdentityStrong(identity);
    const chat = await this.chatService.findOpenChatByIdentity(
      identity.accountId,
      identity.workerId,
      {
        phone: identity.phone,
        remoteJid: identity.remoteJid ?? undefined,
      }
    );

    if (!chat) {
      let repairedRecord = await this.repairStoredInboundTimestamp({
        identity,
        record,
        now,
      });
      if (repairedRecord?.awaiting_contact_reply_since) {
        repairedRecord =
          (await this.repairPendingTemplateFromCanonicalMessage({
            identity,
            record: repairedRecord,
            now,
          })) ?? repairedRecord;
      }
      return this.toSnapshot(repairedRecord, now);
    }

    return this.reconcilePendingWindow({
      chat,
      identity,
      record,
      snapshot: this.toSnapshot(record, now),
      now,
      repairAliases: true,
      repairHistory: true,
      snapshotIsStrong: true,
    });
  };

  applySnapshotToChat = async (
    chat: IChat,
    snapshot: IOfficialWhatsappConversationWindowSnapshot
  ): Promise<IChat> => {
    const identity = this.identityFromChat(chat);
    const currentSnapshot = identity
      ? await this.resolveAuthoritativeForChat(chat)
      : snapshot;
    const synchronized = await this.syncChatSnapshot(chat, currentSnapshot);
    return synchronized ?? { ...chat, official_window: currentSnapshot };
  };

  snapshotAfterTemplateAccepted = (
    snapshot: IOfficialWhatsappConversationWindowSnapshot,
    input: { messageId?: string | null; sentAt: string }
  ): IOfficialWhatsappConversationWindowSnapshot => {
    const expiresAt = snapshot.service_window_expires_at
      ? new Date(snapshot.service_window_expires_at)
      : null;
    const sentAt = new Date(input.sentAt);
    const remainsOpen =
      snapshot.state === 'open' &&
      expiresAt !== null &&
      Number.isFinite(expiresAt.getTime()) &&
      Number.isFinite(sentAt.getTime()) &&
      expiresAt > sentAt;

    if (remainsOpen) {
      return {
        ...snapshot,
        state: 'open',
        reason: 'customer_service_window_open',
        can_send_freeform: true,
        can_send_template: true,
        awaiting_contact_reply_since: null,
        awaiting_contact_reply_expires_at: null,
        awaiting_template_message_id: null,
        last_template_sent_at: input.sentAt,
        last_meta_error_code: null,
        closed_reason: null,
        updated_at: input.sentAt,
      };
    }

    return {
      ...snapshot,
      state: 'awaiting_contact_reply',
      reason: 'customer_reply_required',
      can_send_freeform: false,
      can_send_template: false,
      awaiting_contact_reply_since: input.sentAt,
      awaiting_contact_reply_expires_at: this.addHours(
        input.sentAt,
        CUSTOMER_SERVICE_WINDOW_HOURS
      ),
      awaiting_template_message_id: input.messageId ?? null,
      last_template_sent_at: input.sentAt,
      last_meta_error_code: null,
      closed_reason: 'template_pending',
      updated_at: input.sentAt,
    };
  };

  assertCanSendFreeform = async (
    t: TFunction,
    chat: IChat,
    type: EMessageType
  ): Promise<void> => {
    if (!this.isOfficialChat(chat) || type === EMessageType.annotation) {
      return;
    }

    if (type === EMessageType.official_template) {
      return;
    }

    const window = await this.resolveAuthoritativeForChat(chat);
    if (window.state === 'send_uncertain') {
      throw new Error(t('whatsapp_official_template_send_uncertain'));
    }

    if (window.state === 'awaiting_contact_reply') {
      throw new Error(t('whatsapp_official_waiting_contact_reply'));
    }

    if (window.state === 'closed') {
      throw new Error(t('whatsapp_official_customer_service_window_closed'));
    }
  };

  recordInboundMessage = async (input: RecordInboundInput): Promise<void> => {
    const identity = this.normalizeIdentity(input);
    if (!identity) {
      return;
    }

    const inboundAt =
      this.toIsoString(input.inboundAt) ?? new Date().toISOString();
    const expiresAt = this.addHours(inboundAt, CUSTOMER_SERVICE_WINDOW_HOURS);

    const inboundRecord = await this.repository.upsertInbound({
      ...identity,
      messageId: input.messageId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      inboundAt,
      expiresAt,
    });

    if (input.syncChat !== false) {
      await this.syncOpenChatByIdentity(
        identity,
        this.toSnapshot(inboundRecord, new Date())
      );
    }
  };

  reconcileFromMessages = async (
    chat: IChat,
    messages: readonly InboundWindowMessageCandidate[],
    now = new Date()
  ): Promise<IOfficialWhatsappConversationWindowSnapshot | null> => {
    if (
      !this.isOfficialChat(chat) &&
      !messages.some((message) => Boolean(message.content?.official))
    ) {
      return null;
    }

    const identity = this.identityFromChat(chat);
    if (!identity) {
      return null;
    }

    const record = await this.repository.findByIdentityStrong(identity);
    const snapshot = await this.reconcilePendingWindow({
      chat,
      identity,
      record,
      snapshot: this.toSnapshot(record, now),
      messages,
      now,
      repairAliases: true,
      repairHistory: true,
      syncChat: false,
      snapshotIsStrong: true,
    });
    await this.syncChatSnapshot(chat, snapshot);
    return snapshot;
  };

  recordTemplateSentForChat = async (
    chat: IChat,
    input: RecordTemplateInput
  ): Promise<IChat | null> => {
    const identity = this.identityFromChat(chat);
    if (!identity) {
      return chat;
    }

    const sentAt = this.toIsoString(input.sentAt) ?? new Date().toISOString();
    const record = await this.repository.upsertTemplateSent({
      ...identity,
      templateMessageId: input.messageId ?? null,
      sentAt,
      phase: 'reservation',
    });

    return this.syncChatSnapshot(chat, this.toSnapshot(record, new Date()));
  };

  recordProviderAcceptedMessage = async (
    message: IChatMessage,
    providerMessageId?: string | null
  ): Promise<void> => {
    const identity = this.identityFromMessage(message);
    if (!identity) {
      return;
    }

    const messageId =
      providerMessageId ?? message.message_key?.id ?? message.message_id;
    const sentAt = this.toIsoString(message.date) ?? new Date().toISOString();
    const providerAcceptedAt = new Date().toISOString();

    if (message.content?.type === EMessageType.official_template) {
      const confirmedRecord = await this.repository.confirmAwaitingTemplate({
        ...identity,
        templateMessageIds: this.messageIdCandidates(
          message,
          providerMessageId
        ),
        providerMessageId: messageId,
        providerAcceptedAt,
      });
      const record =
        confirmedRecord ??
        (await this.repository.upsertTemplateSent({
          ...identity,
          templateMessageId: messageId,
          sentAt,
          phase: 'provider_accepted',
          providerAcceptedAt,
        }));
      await this.syncOpenChatByIdentity(
        identity,
        this.toSnapshot(record, new Date())
      );
      return;
    }

    await this.repository.recordOutbound({
      ...identity,
      messageId,
      sentAt,
    });
  };

  recordTemplateFailureForMessage = async (
    message: IChatMessage,
    errorCode?: number | null,
    providerMessageId?: string | null
  ): Promise<void> => {
    if (message.content?.type !== EMessageType.official_template) {
      return;
    }

    const identity = this.identityFromMessage(message);
    if (!identity) {
      return;
    }

    const record = await this.repository.clearAwaitingTemplate({
      ...identity,
      templateMessageIds: this.messageIdCandidates(message, providerMessageId),
      errorCode: errorCode ?? null,
    });
    if (!record) {
      return;
    }

    await this.syncOpenChatByIdentity(
      identity,
      this.toSnapshot(record, new Date())
    );
  };

  recordTemplateUncertainForMessage = async (
    message: IChatMessage,
    providerMessageId?: string | null
  ): Promise<void> => {
    if (message.content?.type !== EMessageType.official_template) {
      return;
    }

    const identity = this.identityFromMessage(message);
    if (!identity) {
      return;
    }

    const record = await this.repository.markAwaitingTemplateUncertain({
      ...identity,
      templateMessageIds: this.messageIdCandidates(message, providerMessageId),
    });
    if (!record) {
      return;
    }

    await this.syncOpenChatByIdentity(
      identity,
      this.toSnapshot(record, new Date())
    );
  };

  markClosedByMetaReengagementForMessage = async (
    message: IChatMessage,
    errorCode = 131047
  ): Promise<void> => {
    const identity = this.identityFromMessage(message);
    if (!identity) {
      return;
    }

    await this.markClosedByMetaReengagementForIdentity(identity, errorCode);
  };

  markClosedByMetaReengagementForIdentity = async (
    input: OfficialWhatsappWindowIdentity,
    errorCode = 131047
  ): Promise<void> => {
    const identity = this.normalizeIdentity(input);
    if (!identity) {
      return;
    }

    const record = await this.repository.markClosedByMetaError({
      ...identity,
      errorCode,
      reason: 'meta_reengagement',
    });
    await this.syncOpenChatByIdentity(
      identity,
      this.toSnapshot(record, new Date())
    );
  };

  private async reconcilePendingWindow(input: {
    chat: IChat;
    identity: OfficialWhatsappWindowIdentity;
    record?: IOfficialWhatsappConversationWindowRecord | null;
    snapshot: IOfficialWhatsappConversationWindowSnapshot;
    messages?: readonly InboundWindowMessageCandidate[];
    now: Date;
    repairAliases?: boolean;
    repairHistory?: boolean;
    syncChat?: boolean;
    snapshotIsStrong?: boolean;
  }): Promise<IOfficialWhatsappConversationWindowSnapshot> {
    let snapshot = input.snapshot;
    let record = input.record;
    if (input.repairHistory === true && record) {
      record = await this.repairStoredInboundTimestamp({
        identity: input.identity,
        record,
        messages: input.messages,
        now: input.now,
      });
      snapshot = this.toSnapshot(record, input.now);
    }

    if (snapshot.state === 'open' && input.repairAliases !== true) {
      return snapshot;
    }
    if (
      snapshot.state === 'closed' &&
      input.repairAliases !== true &&
      input.repairHistory !== true
    ) {
      return snapshot;
    }

    if (input.snapshotIsStrong !== true) {
      const strongRecord = await this.repository.findByIdentityStrong(
        input.identity
      );
      record = input.repairHistory
        ? await this.repairStoredInboundTimestamp({
            identity: input.identity,
            record: strongRecord,
            messages: input.messages,
            now: input.now,
          })
        : strongRecord;
      snapshot = this.toSnapshot(record, input.now);
    }

    const pendingAlias = input.repairAliases
      ? await this.repository.findAwaitingTemplateByIdentityStrong(
          input.identity
        )
      : null;
    const awaitingSince =
      snapshot.awaiting_contact_reply_since ??
      pendingAlias?.awaiting_contact_reply_since ??
      null;

    const serviceWindowExpiresAt = this.toTimestamp(
      snapshot.service_window_expires_at
    );
    const awaitingTimestamp = this.toTimestamp(awaitingSince);
    if (
      snapshot.last_inbound_at &&
      snapshot.service_window_expires_at &&
      serviceWindowExpiresAt !== null &&
      awaitingTimestamp !== null &&
      serviceWindowExpiresAt > awaitingTimestamp
    ) {
      const alignedRecord = await this.repository.upsertInbound({
        ...input.identity,
        messageId: null,
        replyToMessageId:
          pendingAlias?.awaiting_template_message_id ??
          snapshot.awaiting_template_message_id ??
          null,
        inboundAt: snapshot.last_inbound_at,
        expiresAt: snapshot.service_window_expires_at,
      });
      const alignedSnapshot = this.toSnapshot(alignedRecord, input.now);
      if (input.syncChat !== false) {
        await this.syncChatSnapshot(input.chat, alignedSnapshot);
      }
      return alignedSnapshot;
    }

    if (snapshot.state === 'open' && !pendingAlias) {
      return snapshot;
    }

    let repairedPendingTemplate = false;
    const pendingRecord =
      pendingAlias ?? (record?.awaiting_contact_reply_since ? record : null);
    if (input.repairHistory === true && pendingRecord) {
      const canonicalRepair =
        await this.repairPendingTemplateFromCanonicalMessage({
          identity: input.identity,
          record: pendingRecord,
          messages: input.messages,
          now: input.now,
        });
      if (canonicalRepair) {
        record = canonicalRepair;
        snapshot = this.toSnapshot(canonicalRepair, input.now);
        repairedPendingTemplate = true;
      }
    }

    const historyAfter = this.reconciliationLowerBound(
      snapshot,
      awaitingSince,
      input.now
    );

    let inboundMessage = this.findLatestEligibleInboundMessage(
      input.chat,
      input.messages ?? [],
      historyAfter
    );

    if (!inboundMessage) {
      const persistedInbounds =
        await this.chatService.findInboundMessagesByChatIdAfter(
          input.chat.account.id,
          input.chat.chat_id,
          historyAfter
        );
      inboundMessage = this.findLatestEligibleInboundMessage(
        input.chat,
        persistedInbounds,
        historyAfter
      );
    }

    if (!inboundMessage) {
      if (repairedPendingTemplate && input.syncChat !== false) {
        await this.syncChatSnapshot(input.chat, snapshot);
      }
      return snapshot;
    }

    const inboundAt = this.messageTimestamp(inboundMessage);
    if (!inboundAt) {
      if (repairedPendingTemplate && input.syncChat !== false) {
        await this.syncChatSnapshot(input.chat, snapshot);
      }
      return snapshot;
    }

    const inboundRecord = await this.repository.upsertInbound({
      ...input.identity,
      remoteJid:
        inboundMessage.message_key?.remote_jid ??
        input.identity.remoteJid ??
        null,
      messageId:
        inboundMessage.message_key?.id ?? inboundMessage.message_id ?? null,
      replyToMessageId: this.replyToMessageId(inboundMessage),
      inboundAt,
      expiresAt: this.addHours(inboundAt, CUSTOMER_SERVICE_WINDOW_HOURS),
    });
    const repairedSnapshot = this.toSnapshot(inboundRecord, input.now);
    if (input.syncChat !== false) {
      await this.syncChatSnapshot(input.chat, repairedSnapshot);
    }
    return repairedSnapshot;
  }

  private async repairPendingTemplateFromCanonicalMessage(input: {
    identity: OfficialWhatsappWindowIdentity;
    record: IOfficialWhatsappConversationWindowRecord;
    messages?: readonly InboundWindowMessageCandidate[];
    now: Date;
  }): Promise<IOfficialWhatsappConversationWindowRecord | null> {
    const awaitingMessageId = input.record.awaiting_template_message_id?.trim();
    const currentSnapshot = this.toSnapshot(input.record, input.now);
    if (
      !awaitingMessageId ||
      (currentSnapshot.state !== 'awaiting_contact_reply' &&
        currentSnapshot.state !== 'send_uncertain')
    ) {
      return null;
    }

    const canonicalMessage = await this.findCanonicalAwaitingTemplateMessage({
      identity: input.identity,
      awaitingMessageId,
      messages: input.messages,
    });
    if (!canonicalMessage) {
      return null;
    }

    const outcome = this.canonicalTemplateOutcome(canonicalMessage);
    const templateMessageIds = [
      ...new Set(
        [
          awaitingMessageId,
          canonicalMessage.message_id,
          canonicalMessage.message_key?.id,
        ]
          .map((messageId) => messageId?.trim())
          .filter((messageId): messageId is string => Boolean(messageId))
      ),
    ];

    if (outcome === 'failed') {
      return this.repository.clearAwaitingTemplate({
        ...input.identity,
        templateMessageIds,
        errorCode: canonicalMessage.provider_error_code ?? null,
      });
    }

    if (
      outcome === 'ambiguous' &&
      input.record.closed_reason !== 'template_send_uncertain'
    ) {
      return this.repository.markAwaitingTemplateUncertain({
        ...input.identity,
        templateMessageIds,
      });
    }

    if (
      outcome === 'positive' &&
      input.record.closed_reason === 'template_send_uncertain'
    ) {
      const providerAcceptedAt =
        this.toIsoString(canonicalMessage.provider_status_at) ??
        this.toIsoString(canonicalMessage.date);
      if (!providerAcceptedAt) {
        return null;
      }

      return this.repository.confirmAwaitingTemplate({
        ...input.identity,
        templateMessageIds,
        providerMessageId:
          canonicalMessage.message_key?.id ?? awaitingMessageId,
        providerAcceptedAt,
      });
    }

    return null;
  }

  private async findCanonicalAwaitingTemplateMessage(input: {
    identity: OfficialWhatsappWindowIdentity;
    awaitingMessageId: string;
    messages?: readonly InboundWindowMessageCandidate[];
  }): Promise<InboundWindowMessageCandidate | null> {
    const suppliedMessage = input.messages?.find(
      (message) =>
        message.message_id === input.awaitingMessageId ||
        message.message_key?.id === input.awaitingMessageId
    );

    try {
      const internalMessageIds = [
        ...new Set(
          [
            suppliedMessage &&
            this.matchesOfficialTemplateIdentity(
              suppliedMessage,
              input.identity
            )
              ? suppliedMessage.message_id
              : null,
            input.awaitingMessageId,
          ].filter((messageId): messageId is string => Boolean(messageId))
        ),
      ];
      for (const internalMessageId of internalMessageIds) {
        const internalMessage = await this.chatService.findMessageByMessageId(
          input.identity.accountId,
          internalMessageId
        );
        if (
          internalMessage &&
          this.matchesOfficialTemplateIdentity(internalMessage, input.identity)
        ) {
          return internalMessage;
        }
      }

      const providerMessage =
        await this.chatService.findOfficialOutboundMessageByProviderId(
          input.identity.accountId,
          input.identity.workerId,
          input.awaitingMessageId
        );
      return providerMessage &&
        this.matchesOfficialTemplateIdentity(providerMessage, input.identity)
        ? providerMessage
        : null;
    } catch (error) {
      console.warn(
        '[OfficialWhatsappWindow] Awaiting template read repair deferred',
        {
          account_id: input.identity.accountId,
          worker_id: input.identity.workerId,
          awaiting_template_message_id: input.awaitingMessageId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  private matchesOfficialTemplateIdentity(
    message: InboundWindowMessageCandidate,
    identity: OfficialWhatsappWindowIdentity
  ): boolean {
    if (
      message.content?.type !== EMessageType.official_template ||
      message.account?.id !== identity.accountId ||
      message.worker?.id !== identity.workerId ||
      !OUTBOUND_MESSAGE_TYPE_USERS.has(message.type_user as ETypeUserChat) ||
      message.message_key?.from_me === false
    ) {
      return false;
    }

    const phoneFromJid = getPhoneFromJid(
      message.message_key?.remote_jid,
      message.message_key?.remote_jid_alt
    );
    const normalizedPhone = this.normalizePhone(message.phone);
    const normalizedDdi = this.normalizePhone(message.phone_ddi);
    const phoneWithDdi =
      normalizedPhone && normalizedDdi
        ? normalizedPhone.startsWith(normalizedDdi)
          ? normalizedPhone
          : `${normalizedDdi}${normalizedPhone}`
        : normalizedPhone;
    const messagePhone = this.normalizePhone(phoneFromJid ?? phoneWithDdi);
    if (!messagePhone) {
      return false;
    }

    const expectedCandidates = new Set(
      buildCandidates(identity.phone, { order: 'input_first' })
    );
    return buildCandidates(messagePhone, { order: 'input_first' }).some(
      (candidate) => expectedCandidates.has(candidate)
    );
  }

  private canonicalTemplateOutcome(
    message: InboundWindowMessageCandidate
  ): 'positive' | 'ambiguous' | 'failed' | 'unknown' {
    const deliveryStatus = message.delivery_status?.trim().toLowerCase();
    const hasPositiveOutcome =
      deliveryStatus === 'sent' ||
      deliveryStatus === 'delivered' ||
      deliveryStatus === 'read' ||
      message.summary?.is_sent === true ||
      message.summary?.is_delivered === true ||
      message.summary?.is_seen === true;
    if (hasPositiveOutcome) {
      return 'positive';
    }
    if (deliveryStatus === 'ambiguous') {
      return 'ambiguous';
    }
    if (
      deliveryStatus === 'failed' ||
      message.summary?.is_sent_to_internal === false
    ) {
      return 'failed';
    }
    return 'unknown';
  }

  private async repairStoredInboundTimestamp(input: {
    identity: OfficialWhatsappWindowIdentity;
    record: IOfficialWhatsappConversationWindowRecord | null;
    messages?: readonly InboundWindowMessageCandidate[];
    now: Date;
  }): Promise<IOfficialWhatsappConversationWindowRecord | null> {
    const providerMessageId = input.record?.last_inbound_message_id?.trim();
    if (!input.record || !providerMessageId || !input.record.last_inbound_at) {
      return input.record;
    }

    const messageFromInput = input.messages?.find(
      (message) => this.providerMessageId(message) === providerMessageId
    );
    const message =
      messageFromInput ??
      (await this.chatService.findOfficialInboundMessageByProviderId(
        input.identity.accountId,
        input.identity.workerId,
        providerMessageId
      ));
    if (!message) {
      return input.record;
    }

    const resolution = resolveOfficialWhatsappInboundTimestampWithSource({
      providerTimestamp: message.content?.official?.raw?.timestamp,
      persistedAt: message.date,
      now: input.now,
    });
    if (resolution.source !== 'provider') {
      return input.record;
    }

    const storedTimestamp = this.toTimestamp(input.record.last_inbound_at);
    const providerTimestamp = this.toTimestamp(resolution.timestamp);
    if (storedTimestamp === null || providerTimestamp === null) {
      return input.record;
    }

    const persistedMessageTimestamp = this.toTimestamp(message.date);
    if (persistedMessageTimestamp !== providerTimestamp && message.message_id) {
      try {
        const repaired =
          await this.chatService.repairOfficialInboundMessageTimestamp({
            accountId: input.identity.accountId,
            workerId: input.identity.workerId,
            internalMessageId: message.message_id,
            providerMessageId,
            correctedAt: resolution.timestamp,
          });
        if (repaired) {
          message.date = resolution.timestamp;
        }
      } catch (error) {
        console.warn(
          '[OfficialWhatsappWindow] Inbound message timestamp repair deferred',
          {
            account_id: input.identity.accountId,
            worker_id: input.identity.workerId,
            provider_message_id: providerMessageId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (storedTimestamp === providerTimestamp) {
      return input.record;
    }

    return (
      (await this.repository.repairInboundTimestamp({
        ...input.identity,
        expectedMessageId: providerMessageId,
        inboundAt: resolution.timestamp,
        expiresAt: this.addHours(
          resolution.timestamp,
          CUSTOMER_SERVICE_WINDOW_HOURS
        ),
      })) ?? input.record
    );
  }

  private providerMessageId(
    message: InboundWindowMessageCandidate
  ): string | null {
    const rawMessageId = message.content?.official?.raw?.id;
    const candidates = [
      message.message_key?.id,
      message.content?.official?.message_id,
      typeof rawMessageId === 'string' ? rawMessageId : null,
    ];

    return candidates.find((candidate) => candidate?.trim())?.trim() ?? null;
  }

  private reconciliationLowerBound(
    snapshot: IOfficialWhatsappConversationWindowSnapshot,
    awaitingSince: string | null,
    now: Date
  ): string {
    if (awaitingSince) {
      return awaitingSince;
    }

    const closedAt =
      snapshot.reason === 'meta_reengagement'
        ? snapshot.service_window_expires_at
        : snapshot.reason === 'template_failed'
          ? snapshot.last_template_sent_at
          : snapshot.last_inbound_at;

    return closedAt ?? this.addHours(now.toISOString(), -24);
  }

  private findLatestEligibleInboundMessage(
    chat: IChat,
    messages: readonly InboundWindowMessageCandidate[],
    after: string
  ): InboundWindowMessageCandidate | null {
    const afterTimestamp = this.toTimestamp(after);
    if (afterTimestamp === null) {
      return null;
    }

    return (
      messages
        .filter((message) => {
          const messageTimestamp = this.messageTimestampValue(message);
          return (
            message.chat_id === chat.chat_id &&
            message.type_user === ETypeUserChat.client &&
            message.message_key?.from_me !== true &&
            message.content?.official?.echo !== true &&
            messageTimestamp !== null &&
            messageTimestamp > afterTimestamp
          );
        })
        .sort(
          (left, right) =>
            (this.messageTimestampValue(right) ?? 0) -
            (this.messageTimestampValue(left) ?? 0)
        )[0] ?? null
    );
  }

  private messageTimestamp(
    message: InboundWindowMessageCandidate
  ): string | null {
    const timestamp = this.messageTimestampValue(message);
    return timestamp === null ? null : new Date(timestamp).toISOString();
  }

  private messageTimestampValue(
    message: InboundWindowMessageCandidate
  ): number | null {
    const rawTimestamp = message.content?.official?.raw?.timestamp;
    return this.toTimestamp(
      resolveOfficialWhatsappInboundTimestamp({
        providerTimestamp: rawTimestamp,
        persistedAt: message.date,
      })
    );
  }

  private replyToMessageId(
    message: InboundWindowMessageCandidate
  ): string | null {
    const quotedMessageId = message.content?.message_quoted_id?.trim();
    if (quotedMessageId) {
      return quotedMessageId;
    }

    const rawContext = message.content?.official?.raw?.context;
    if (!rawContext || typeof rawContext !== 'object') {
      return null;
    }

    const contextId = (rawContext as Record<string, unknown>).id;
    return typeof contextId === 'string' && contextId.trim()
      ? contextId.trim()
      : null;
  }

  private toTimestamp(value?: string | null): number | null {
    if (!value) {
      return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private isOfficialChat(chat: IChat): boolean {
    return (
      chat.official_window?.is_official === true ||
      chat.worker?.is_official === true ||
      isOfficialWhatsappWorker(chat.worker?.type_id)
    );
  }

  private toSnapshot(
    record: IOfficialWhatsappConversationWindowRecord | null,
    now: Date
  ): IOfficialWhatsappConversationWindowSnapshot {
    const expiresAt = record?.service_window_expires_at
      ? new Date(record.service_window_expires_at)
      : null;
    const awaitingReplyExpiresAt = record?.awaiting_contact_reply_since
      ? new Date(
          this.addHours(
            record.awaiting_contact_reply_since,
            CUSTOMER_SERVICE_WINDOW_HOURS
          )
        )
      : null;
    const isExplicitMetaClosure = record?.closed_reason === 'meta_reengagement';

    if (
      !isExplicitMetaClosure &&
      expiresAt &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt > now
    ) {
      return {
        is_official: true,
        state: 'open',
        reason: 'customer_service_window_open',
        can_send_freeform: true,
        can_send_template: true,
        service_window_started_at: record?.last_inbound_at ?? null,
        last_inbound_at: record?.last_inbound_at ?? null,
        service_window_expires_at: record?.service_window_expires_at ?? null,
        awaiting_contact_reply_since: null,
        awaiting_contact_reply_expires_at: null,
        awaiting_template_message_id: null,
        last_template_sent_at: record?.last_template_sent_at ?? null,
        last_meta_error_code: record?.last_meta_error_code ?? null,
        closed_reason: null,
        updated_at: record?.updated_at ?? null,
      };
    }

    if (
      record?.closed_reason === 'template_send_uncertain' &&
      awaitingReplyExpiresAt &&
      Number.isFinite(awaitingReplyExpiresAt.getTime()) &&
      awaitingReplyExpiresAt > now
    ) {
      return {
        is_official: true,
        state: 'send_uncertain',
        reason: 'template_send_uncertain',
        can_send_freeform: false,
        can_send_template: false,
        service_window_started_at: record.last_inbound_at ?? null,
        last_inbound_at: record.last_inbound_at ?? null,
        service_window_expires_at: record.service_window_expires_at ?? null,
        awaiting_contact_reply_since: record.awaiting_contact_reply_since,
        awaiting_contact_reply_expires_at: awaitingReplyExpiresAt.toISOString(),
        awaiting_template_message_id:
          record.awaiting_template_message_id ?? null,
        last_template_sent_at: record.last_template_sent_at ?? null,
        last_meta_error_code: record.last_meta_error_code ?? null,
        closed_reason: record.closed_reason,
        updated_at: record.updated_at ?? null,
      };
    }

    if (
      record?.awaiting_contact_reply_since &&
      awaitingReplyExpiresAt &&
      Number.isFinite(awaitingReplyExpiresAt.getTime()) &&
      awaitingReplyExpiresAt > now
    ) {
      return {
        is_official: true,
        state: 'awaiting_contact_reply',
        reason: 'customer_reply_required',
        can_send_freeform: false,
        can_send_template: false,
        service_window_started_at: record.last_inbound_at ?? null,
        last_inbound_at: record.last_inbound_at ?? null,
        service_window_expires_at: record.service_window_expires_at ?? null,
        awaiting_contact_reply_since: record.awaiting_contact_reply_since,
        awaiting_contact_reply_expires_at: awaitingReplyExpiresAt.toISOString(),
        awaiting_template_message_id:
          record.awaiting_template_message_id ?? null,
        last_template_sent_at: record.last_template_sent_at ?? null,
        last_meta_error_code: record.last_meta_error_code ?? null,
        closed_reason: record.closed_reason ?? 'template_pending',
        updated_at: record.updated_at ?? null,
      };
    }

    return {
      is_official: true,
      state: 'closed',
      reason:
        record?.closed_reason === 'meta_reengagement'
          ? 'meta_reengagement'
          : record?.closed_reason === 'template_failed'
            ? 'template_failed'
            : record?.closed_reason === 'template_send_uncertain'
              ? 'template_send_uncertain'
              : record?.last_inbound_at
                ? 'customer_service_window_closed'
                : 'no_customer_message',
      can_send_freeform: false,
      can_send_template: true,
      service_window_started_at: record?.last_inbound_at ?? null,
      last_inbound_at: record?.last_inbound_at ?? null,
      service_window_expires_at: record?.service_window_expires_at ?? null,
      awaiting_contact_reply_since: null,
      awaiting_contact_reply_expires_at: null,
      awaiting_template_message_id: null,
      last_template_sent_at: record?.last_template_sent_at ?? null,
      last_meta_error_code: record?.last_meta_error_code ?? null,
      closed_reason: record?.closed_reason ?? null,
      updated_at: record?.updated_at ?? null,
    };
  }

  private messageIdCandidates(
    message: IChatMessage,
    providerMessageId?: string | null
  ): string[] {
    return [
      ...new Set([
        providerMessageId,
        message.message_key?.id,
        message.message_id,
      ]),
    ]
      .map((messageId) => messageId?.trim())
      .filter((messageId): messageId is string => Boolean(messageId));
  }

  private async syncOpenChatByIdentity(
    identity: OfficialWhatsappWindowIdentity,
    snapshot?: IOfficialWhatsappConversationWindowSnapshot
  ): Promise<void> {
    const chat = await this.chatService.findOpenChatByIdentity(
      identity.accountId,
      identity.workerId,
      {
        phone: identity.phone,
        remoteJid: identity.remoteJid ?? undefined,
      }
    );

    if (!chat) {
      return;
    }

    await this.syncChatSnapshot(chat, snapshot);
  }

  private async syncChatSnapshot(
    chat: IChat,
    snapshot?: IOfficialWhatsappConversationWindowSnapshot
  ): Promise<IChat | null> {
    if (!OPEN_CHAT_STATUSES.has(chat.status)) {
      return chat;
    }

    const hydrated = snapshot
      ? { ...chat, official_window: snapshot }
      : await this.hydrateChat(chat);
    if (!hydrated) {
      return null;
    }

    if (
      JSON.stringify(chat.official_window ?? null) ===
      JSON.stringify(hydrated.official_window ?? null)
    ) {
      return chat;
    }

    const officialWindow = hydrated.official_window ?? null;
    const saved = await this.chatService.applyChatPatch(
      chat.chat_id,
      { official_window: officialWindow },
      {
        allowCreate: false,
        refresh: true,
        expectedCurrentStatuses: [...OPEN_CHAT_STATUSES],
        outboundWebhook: {
          eventTypes: ['chat.updated'],
          idempotencyKey: `official-window:${chat.chat_id}:${JSON.stringify(
            officialWindow
          )}`,
          source: 'official_whatsapp_window',
          previousChat: chat,
          actor: { type: 'system' },
          changes: { official_window: officialWindow },
        },
      }
    );
    if (!saved) {
      return null;
    }

    const currentChat = await this.chatService.findChatByChatId(
      chat.account.id,
      chat.chat_id
    );
    if (!currentChat) {
      return null;
    }

    await Promise.all([
      this.chatService.invalidateChatCache(chat),
      this.chatService.invalidateChatCache(currentChat),
    ]);

    if (currentChat.account?.id) {
      await Promise.allSettled([
        this.centrifugoService.publishSub(
          chatAccountCentrifugo(currentChat.account.id),
          currentChat
        ),
        this.centrifugoService.publishSub(
          chatQueueAccountCentrifugo(currentChat.account.id),
          currentChat
        ),
      ]);
    }

    return currentChat;
  }

  private identityFromChat(chat: IChat): OfficialWhatsappWindowIdentity | null {
    const phone = this.normalizePhone(chat.phone ?? chat.contact?.phone);
    if (!chat.account?.id || !chat.worker?.id || !phone) {
      return null;
    }

    return {
      accountId: chat.account.id,
      workerId: chat.worker.id,
      contactId: chat.contact?.id ?? null,
      phone,
      remoteJid: chat.message_key?.remote_jid ?? null,
    };
  }

  private identityFromMessage(
    message: IChatMessage
  ): OfficialWhatsappWindowIdentity | null {
    const phoneFromJid = getPhoneFromJid(
      message.message_key?.remote_jid,
      message.message_key?.remote_jid_alt
    );
    const normalizedPhone = this.normalizePhone(message.phone);
    const normalizedDdi = this.normalizePhone(message.phone_ddi);
    const phoneWithDdi =
      normalizedPhone && normalizedDdi
        ? normalizedPhone.startsWith(normalizedDdi)
          ? normalizedPhone
          : `${normalizedDdi}${normalizedPhone}`
        : normalizedPhone;
    const phone = this.normalizePhone(phoneFromJid ?? phoneWithDdi);
    if (!message.account?.id || !message.worker?.id || !phone) {
      return null;
    }

    return {
      accountId: message.account.id,
      workerId: message.worker.id,
      phone,
      remoteJid: message.message_key?.remote_jid ?? null,
    };
  }

  private normalizeIdentity(
    input: OfficialWhatsappWindowIdentity
  ): OfficialWhatsappWindowIdentity | null {
    const phone = this.normalizePhone(input.phone ?? input.remoteJid);
    if (!input.accountId || !input.workerId || !phone) {
      return null;
    }

    return {
      accountId: input.accountId,
      workerId: input.workerId,
      contactId: input.contactId ?? null,
      phone,
      remoteJid: input.remoteJid ?? null,
    };
  }

  private normalizePhone(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    const jidPhone = value.includes('@') ? value.split('@')[0] : value;
    const digits = jidPhone.replace(/\D/g, '');
    return digits.length > 0 ? digits : null;
  }

  private toIsoString(value?: string | Date | null): string | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  private addHours(value: string, hours: number): string {
    const date = new Date(value);
    date.setTime(date.getTime() + hours * 60 * 60 * 1000);
    return date.toISOString();
  }
}
