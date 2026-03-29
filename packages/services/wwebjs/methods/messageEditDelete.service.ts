import { injectable, inject } from 'tsyringe';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMessageKeyInput } from '@core/common/interfaces/IMessageKeyInput';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';

export interface IWwebjsForwardMessageResult {
  sent: boolean;
  messageKey?: IMessageKeyResponse;
  resolution_path: 'direct' | 'snapshot_poll' | 'unresolved';
  error?: string;
}

@injectable()
export class WwebjsMessageEditDeleteService {
  private readonly FORWARD_POLL_TIMEOUT_MS = 8000;
  private readonly FORWARD_POLL_INTERVAL_MS = 350;
  private readonly FORWARD_POLL_FETCH_LIMIT = 20;
  private readonly FORWARD_SOURCE_SCAN_FETCH_LIMIT = 100;
  private readonly FORWARD_TIMESTAMP_FUZZ_MS = 15000;

  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  private describeKey(key: IMessageKeyInput): Record<string, unknown> {
    return {
      id: key.id,
      remote_jid: key.remoteJid ?? key.remote_jid ?? null,
      remote_jid_alt: key.remoteJidAlt ?? key.remote_jid_alt ?? null,
      from_me: key.fromMe ?? key.from_me ?? null,
      participant: key.participant ?? null,
      participant_alt: key.participant_alt ?? null,
    };
  }

  private describeError(error: unknown): {
    name?: string;
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    if (typeof error === 'string') {
      return { message: error };
    }

    return { message: String(error ?? '') };
  }

  async deleteMessage(
    key: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const startedAt = Date.now();
    const candidates = this.buildSerializedIdCandidates(key);
    console.info('[WwebjsEditDelete] delete_start', {
      key: this.describeKey(key),
      candidate_count: candidates.length,
      candidates,
    });

    const msg = await this.resolveMessageByKey(key);

    if (!msg) {
      console.warn('[WwebjsEditDelete] delete_not_found', {
        key: this.describeKey(key),
        duration_ms: Date.now() - startedAt,
      });
      throw new Error('Failed to delete message: message_not_found');
    }

    try {
      await msg.delete(true);
      console.info('[WwebjsEditDelete] delete_success', {
        key: this.describeKey(key),
        duration_ms: Date.now() - startedAt,
      });
    } catch (error) {
      console.error('[WwebjsEditDelete] delete_failed', {
        key: this.describeKey(key),
        duration_ms: Date.now() - startedAt,
        error: this.describeError(error),
      });
      throw error;
    }

    return undefined;
  }

  private buildSerializedIdCandidates(
    key: IMessageKeyInput,
    chatJid?: string
  ): string[] {
    const rawId = key.id?.trim();
    if (!rawId) {
      return [];
    }

    const parsed = parseSerializedMessageId(rawId);
    const stanzaId = parsed?.stanzaId ?? rawId;
    const fromMeCandidates = this.buildFromMeCandidates(key, parsed);
    const remoteCandidates = this.buildRemoteCandidates(key, chatJid, parsed);

    const candidates = new Set<string>();
    if (parsed) {
      candidates.add(rawId);
    }

    for (const remoteJid of remoteCandidates) {
      for (const fromMe of fromMeCandidates) {
        candidates.add(`${fromMe}_${remoteJid}_${stanzaId}`);
      }
    }

    candidates.add(rawId);
    return Array.from(candidates);
  }

  private buildJidAliases(jid: string): string[] {
    const normalized = jid.trim();
    if (!normalized) {
      return [];
    }

    const aliases = new Set<string>([normalized]);
    if (normalized.endsWith('@s.whatsapp.net')) {
      aliases.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
    }

    if (normalized.endsWith('@c.us')) {
      aliases.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
    }

    return Array.from(aliases);
  }

  private buildFromMeCandidates(
    key: IMessageKeyInput,
    parsed: ReturnType<typeof parseSerializedMessageId>
  ): boolean[] {
    if (typeof key.fromMe === 'boolean') {
      return [key.fromMe];
    }

    if (typeof key.from_me === 'boolean') {
      return [key.from_me];
    }

    if (typeof parsed?.fromMe === 'boolean') {
      return [parsed.fromMe];
    }

    return [false, true];
  }

  private buildRemoteCandidates(
    key: IMessageKeyInput,
    chatJid: string | undefined,
    parsed: ReturnType<typeof parseSerializedMessageId>
  ): string[] {
    const directRemote = (key.remoteJid ?? key.remote_jid ?? '').trim();
    const directRemoteAlt = (
      key.remoteJidAlt ??
      key.remote_jid_alt ??
      ''
    ).trim();
    const rawCandidates = [
      directRemote,
      directRemoteAlt,
      chatJid?.trim() ?? '',
      parsed?.remoteJid?.trim() ?? '',
    ].filter(Boolean);

    const remoteCandidates = new Set<string>();
    for (const rawCandidate of rawCandidates) {
      for (const alias of this.buildJidAliases(rawCandidate)) {
        remoteCandidates.add(alias);
      }
    }

    return Array.from(remoteCandidates);
  }

  private extractStanzaIdFromMessage(message: unknown): string | undefined {
    const serialized = this.extractSerializedIdFromMessage(message);
    const parsed = serialized ? parseSerializedMessageId(serialized) : null;
    if (parsed?.stanzaId) {
      return parsed.stanzaId;
    }

    const idValue = (message as { id?: unknown })?.id;
    if (
      typeof idValue === 'object' &&
      idValue !== null &&
      'id' in (idValue as object)
    ) {
      const stanzaId = (idValue as { id?: unknown }).id;
      if (typeof stanzaId === 'string' && stanzaId.trim()) {
        return stanzaId.trim();
      }
    }

    return undefined;
  }

  private extractFromMeFromMessage(message: unknown): boolean | undefined {
    const serialized = this.extractSerializedIdFromMessage(message);
    const parsed = serialized ? parseSerializedMessageId(serialized) : null;
    if (typeof parsed?.fromMe === 'boolean') {
      return parsed.fromMe;
    }

    const directFromMe = (message as { fromMe?: unknown })?.fromMe;
    if (typeof directFromMe === 'boolean') {
      return directFromMe;
    }

    const idValue = (message as { id?: unknown })?.id;
    if (
      typeof idValue === 'object' &&
      idValue !== null &&
      'fromMe' in (idValue as object)
    ) {
      const idFromMe = (idValue as { fromMe?: unknown }).fromMe;
      if (typeof idFromMe === 'boolean') {
        return idFromMe;
      }
    }

    return undefined;
  }

  private async resolveMessageByChatScan(
    key: IMessageKeyInput,
    chatJid: string | undefined,
    serializedCandidates: string[]
  ): Promise<any | null> {
    const client = this.helpers.getClient();
    const rawId = key.id?.trim();
    if (!rawId) {
      return null;
    }

    const parsed = parseSerializedMessageId(rawId);
    const stanzaId = parsed?.stanzaId ?? rawId;
    if (!stanzaId) {
      return null;
    }

    const fromMeCandidates = new Set(this.buildFromMeCandidates(key, parsed));
    const remoteCandidates = this.buildRemoteCandidates(key, chatJid, parsed);
    const serializedSet = new Set(serializedCandidates);
    serializedSet.add(rawId);

    for (const remoteCandidate of remoteCandidates) {
      let chatMessages: any[] = [];

      try {
        const chat = await client.getChatById(remoteCandidate);
        if (
          !chat ||
          typeof (chat as { fetchMessages?: unknown }).fetchMessages !==
            'function'
        ) {
          continue;
        }

        chatMessages = await (
          chat as {
            fetchMessages: (searchOptions: {
              limit?: number;
              fromMe?: boolean;
            }) => Promise<any[]>;
          }
        ).fetchMessages({
          limit: this.FORWARD_SOURCE_SCAN_FETCH_LIMIT,
        });
      } catch {
        continue;
      }

      if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
        continue;
      }

      for (const chatMessage of chatMessages) {
        const serialized = this.extractSerializedIdFromMessage(chatMessage);
        if (serialized && serializedSet.has(serialized)) {
          return chatMessage;
        }

        const messageStanzaId = this.extractStanzaIdFromMessage(chatMessage);
        if (!messageStanzaId || messageStanzaId !== stanzaId) {
          continue;
        }

        const messageFromMe = this.extractFromMeFromMessage(chatMessage);
        if (
          messageFromMe === undefined ||
          fromMeCandidates.has(messageFromMe)
        ) {
          return chatMessage;
        }
      }
    }

    return null;
  }

  private async resolveMessageByKey(
    key: IMessageKeyInput,
    chatJid?: string
  ): Promise<any | null> {
    const client = this.helpers.getClient();
    const candidates = this.buildSerializedIdCandidates(key, chatJid);

    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      try {
        const message = await client.getMessageById(candidate);
        if (message) {
          return message;
        }
      } catch {}
    }

    const scannedMessage = await this.resolveMessageByChatScan(
      key,
      chatJid,
      candidates
    );
    if (scannedMessage) {
      return scannedMessage;
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractSerializedIdFromMessage(msg: unknown): string | undefined {
    if (!msg || typeof msg !== 'object') {
      return undefined;
    }

    const idValue = (msg as { id?: unknown }).id;
    if (!idValue) {
      return undefined;
    }

    if (
      typeof idValue === 'object' &&
      idValue !== null &&
      '_serialized' in (idValue as object)
    ) {
      const serialized = (idValue as { _serialized?: unknown })._serialized;
      return typeof serialized === 'string' && serialized.trim()
        ? serialized
        : undefined;
    }

    if (typeof idValue === 'string' && idValue.trim()) {
      return idValue;
    }

    return undefined;
  }

  private toEpochMillis(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    if (value > 1_000_000_000_000) {
      return Math.floor(value);
    }

    return Math.floor(value * 1000);
  }

  private async fetchRecentFromMeMessages(
    destinationJid: string
  ): Promise<any[]> {
    const client = this.helpers.getClient();

    try {
      const chat = await client.getChatById(destinationJid);
      if (
        !chat ||
        typeof (chat as { fetchMessages?: unknown }).fetchMessages !==
          'function'
      ) {
        return [];
      }

      const messages = await (
        chat as {
          fetchMessages: (searchOptions: {
            limit?: number;
            fromMe?: boolean;
          }) => Promise<any[]>;
        }
      ).fetchMessages({
        limit: this.FORWARD_POLL_FETCH_LIMIT,
        fromMe: true,
      });

      return Array.isArray(messages) ? messages : [];
    } catch {
      return [];
    }
  }

  private async snapshotDestinationMessageIds(
    destinationJid: string
  ): Promise<Set<string>> {
    const messages = await this.fetchRecentFromMeMessages(destinationJid);
    const ids = new Set<string>();

    for (const message of messages) {
      const id = this.extractSerializedIdFromMessage(message);
      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }

  private pickRecentForwardedCandidate(
    messages: any[],
    snapshotIds: Set<string>,
    forwardStartedAtMs: number
  ): any | null {
    const freshCandidates: Array<{ message: any; ts: number }> = [];

    for (const message of messages) {
      const serializedId = this.extractSerializedIdFromMessage(message);
      if (!serializedId || snapshotIds.has(serializedId)) {
        continue;
      }

      const timestampMs = this.toEpochMillis(
        (message as { timestamp?: unknown }).timestamp
      );
      if (
        timestampMs !== null &&
        timestampMs < forwardStartedAtMs - this.FORWARD_TIMESTAMP_FUZZ_MS
      ) {
        continue;
      }

      freshCandidates.push({
        message,
        ts: timestampMs ?? Number.MAX_SAFE_INTEGER,
      });
    }

    if (!freshCandidates.length) {
      return null;
    }

    freshCandidates.sort((a, b) => b.ts - a.ts);
    return freshCandidates[0].message;
  }

  private async resolveForwardedMessageByPolling(
    destinationJid: string,
    snapshotIds: Set<string>,
    forwardStartedAtMs: number
  ): Promise<any | null> {
    const timeoutAt = Date.now() + this.FORWARD_POLL_TIMEOUT_MS;

    while (Date.now() <= timeoutAt) {
      const messages = await this.fetchRecentFromMeMessages(destinationJid);
      const candidate = this.pickRecentForwardedCandidate(
        messages,
        snapshotIds,
        forwardStartedAtMs
      );

      if (candidate) {
        return candidate;
      }

      await this.sleep(this.FORWARD_POLL_INTERVAL_MS);
    }

    return null;
  }

  async editText(
    newText: string,
    editKey: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const startedAt = Date.now();
    const candidates = this.buildSerializedIdCandidates(editKey);
    console.info('[WwebjsEditDelete] edit_start', {
      key: this.describeKey(editKey),
      text_length: newText.length,
      candidate_count: candidates.length,
      candidates,
    });

    const msg = await this.resolveMessageByKey(editKey);

    if (!msg) {
      console.warn('[WwebjsEditDelete] edit_not_found', {
        key: this.describeKey(editKey),
        duration_ms: Date.now() - startedAt,
      });
      return undefined;
    }

    if (typeof (msg as { edit?: unknown }).edit !== 'function') {
      console.warn('[WwebjsEditDelete] edit_unsupported', {
        key: this.describeKey(editKey),
        duration_ms: Date.now() - startedAt,
      });
      return undefined;
    }

    try {
      const editedMessage = (await (
        msg as { edit: (t: string) => Promise<unknown> }
      ).edit(newText)) as Parameters<typeof messageToWaLike>[0];
      const normalized = messageToWaLike(editedMessage ?? undefined);
      if (!normalized) {
        console.warn('[WwebjsEditDelete] edit_not_allowed_or_null', {
          key: this.describeKey(editKey),
          duration_ms: Date.now() - startedAt,
        });
        return undefined;
      }

      console.info('[WwebjsEditDelete] edit_success', {
        key: this.describeKey(editKey),
        duration_ms: Date.now() - startedAt,
      });
      return normalized;
    } catch (error) {
      console.error('[WwebjsEditDelete] edit_failed', {
        key: this.describeKey(editKey),
        duration_ms: Date.now() - startedAt,
        error: this.describeError(error),
      });
      throw error;
    }
  }

  async forwardMessage(
    destinationJid: string,
    sourceKey: IMessageKeyInput
  ): Promise<IWwebjsForwardMessageResult> {
    const msg = await this.resolveMessageByKey(sourceKey, destinationJid);

    if (
      !msg ||
      typeof (msg as { forward?: (chatId: string) => Promise<unknown> })
        .forward !== 'function'
    ) {
      return {
        sent: false,
        resolution_path: 'unresolved',
        error: 'source_message_not_found',
      };
    }

    const snapshotIds =
      await this.snapshotDestinationMessageIds(destinationJid);
    const forwardStartedAtMs = Date.now();

    try {
      const forwarded = (await (
        msg as { forward: (chatId: string) => Promise<unknown> }
      ).forward(destinationJid)) as
        | Parameters<typeof messageToWaLike>[0]
        | null
        | undefined;

      const directKey = messageToWaLike(forwarded);
      if (directKey) {
        return {
          sent: true,
          messageKey: directKey,
          resolution_path: 'direct',
        };
      }

      const polledMessage = await this.resolveForwardedMessageByPolling(
        destinationJid,
        snapshotIds,
        forwardStartedAtMs
      );
      const polledKey = messageToWaLike(polledMessage);

      if (polledKey) {
        return {
          sent: true,
          messageKey: polledKey,
          resolution_path: 'snapshot_poll',
        };
      }

      return {
        sent: true,
        resolution_path: 'unresolved',
      };
    } catch (error) {
      return {
        sent: false,
        resolution_path: 'unresolved',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
