import { injectable, inject } from 'tsyringe';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMessageKeyInput } from '@core/common/interfaces/IMessageKeyInput';

type ParsedMessageId = ReturnType<typeof parseSerializedMessageId>;

@injectable()
export class WwebjsMessageReactionsInteractionsService {
  private readonly REACTION_SOURCE_SCAN_FETCH_LIMIT = 100;

  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async react(
    key: IMessageKeyInput,
    emoji: string
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const msg = await this.resolveMessageByKey(key);
    if (!msg) {
      return undefined;
    }

    const serializedId = this.extractSerializedIdFromMessage(msg);
    if (!serializedId) {
      return undefined;
    }

    const pupPage = client.pupPage;
    if (!pupPage) {
      throw new Error('Wwebjs puppeteer page not available');
    }

    await pupPage.evaluate(
      async (messageId: string, reaction: string) => {
        if (!messageId) {
          return;
        }

        const browserGlobal = globalThis as unknown as {
          require: (module: string) => unknown;
        };
        const collections = browserGlobal.require('WAWebCollections') as {
          Msg: {
            get: (id: string) => unknown;
            getMessagesById: (
              ids: string[]
            ) => Promise<{ messages?: unknown[] } | undefined>;
          };
        };
        const message =
          collections.Msg.get(messageId) ||
          (await collections.Msg.getMessagesById([messageId]))?.messages?.[0];
        if (!message) {
          return;
        }

        const reactionAction = browserGlobal.require(
          'WAWebSendReactionMsgAction'
        ) as {
          sendReactionToMsg: (
            message: unknown,
            reactionText: string
          ) => Promise<unknown>;
        };
        await reactionAction.sendReactionToMsg(message, reaction);
      },
      serializedId,
      emoji
    );

    return messageToWaLike(msg);
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
    parsed: ParsedMessageId
  ): boolean[] {
    if (typeof key.fromMe === 'boolean') {
      return [key.fromMe, !key.fromMe];
    }

    if (typeof key.from_me === 'boolean') {
      return [key.from_me, !key.from_me];
    }

    if (typeof parsed?.fromMe === 'boolean') {
      return [parsed.fromMe, !parsed.fromMe];
    }

    return [false, true];
  }

  private buildRemoteCandidates(
    key: IMessageKeyInput,
    parsed: ParsedMessageId
  ): string[] {
    const rawCandidates = [
      key.remoteJid?.trim() ?? '',
      key.remote_jid?.trim() ?? '',
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

  private buildSerializedIdCandidates(key: IMessageKeyInput): string[] {
    const rawId = key.id?.trim();
    if (!rawId) {
      return [];
    }

    const parsed = parseSerializedMessageId(rawId);
    const stanzaId = parsed?.stanzaId ?? rawId;
    const fromMeCandidates = this.buildFromMeCandidates(key, parsed);
    const remoteCandidates = this.buildRemoteCandidates(key, parsed);

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
        ? serialized.trim()
        : undefined;
    }

    if (typeof idValue === 'string' && idValue.trim()) {
      return idValue.trim();
    }

    return undefined;
  }

  private extractStanzaIdFromMessage(msg: unknown): string | undefined {
    const serialized = this.extractSerializedIdFromMessage(msg);
    const parsed = serialized ? parseSerializedMessageId(serialized) : null;
    if (parsed?.stanzaId) {
      return parsed.stanzaId;
    }

    const idValue = (msg as { id?: unknown })?.id;
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

  private extractFromMeFromMessage(msg: unknown): boolean | undefined {
    const serialized = this.extractSerializedIdFromMessage(msg);
    const parsed = serialized ? parseSerializedMessageId(serialized) : null;
    if (typeof parsed?.fromMe === 'boolean') {
      return parsed.fromMe;
    }

    const directFromMe = (msg as { fromMe?: unknown })?.fromMe;
    if (typeof directFromMe === 'boolean') {
      return directFromMe;
    }

    const idValue = (msg as { id?: unknown })?.id;
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
    const remoteCandidates = this.buildRemoteCandidates(key, parsed);
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
          limit: this.REACTION_SOURCE_SCAN_FETCH_LIMIT,
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
    key: IMessageKeyInput
  ): Promise<any | null> {
    const client = this.helpers.getClient();
    const candidates = this.buildSerializedIdCandidates(key);
    if (!candidates.length) {
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

    return this.resolveMessageByChatScan(key, candidates);
  }
}
