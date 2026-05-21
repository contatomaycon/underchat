import { inject, singleton } from 'tsyringe';
import type { Client, Message } from '@wwebjs/whatsapp-web.js';
import { WwebjsIncomingMessageService } from './incoming.service';

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

interface WwebjsHistoryChat {
  id?: { _serialized?: string } | string;
  isGroup?: boolean;
  timestamp?: number;
  fetchMessages?: (searchOptions: {
    limit?: number;
    fromMe?: boolean;
  }) => Promise<Message[]>;
}

@singleton()
export class WwebjsHistoryReconciliationService {
  private currentClient: Client | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private isScanning = false;

  private readonly enabled =
    process.env.HISTORY_RECONCILIATION_ENABLED !== 'false';
  private readonly intervalMs = readPositiveIntEnv(
    'HISTORY_RECONCILIATION_INTERVAL_MS',
    60_000
  );
  private readonly messageLimit = readPositiveIntEnv(
    'HISTORY_RECONCILIATION_MESSAGE_LIMIT',
    100
  );
  private readonly maxChatsPerCycle = readPositiveIntEnv(
    'HISTORY_RECONCILIATION_MAX_CHATS_PER_CYCLE',
    25
  );
  private readonly maxAgeMs = readPositiveIntEnv(
    'HISTORY_RECONCILIATION_MAX_AGE_MS',
    6 * 60 * 60 * 1000
  );

  constructor(
    @inject(WwebjsIncomingMessageService)
    private readonly incomingMessageService: WwebjsIncomingMessageService
  ) {}

  public start(client: Client): void {
    if (!this.enabled) {
      return;
    }

    if (this.currentClient === client && this.timer) {
      return;
    }

    this.stop();
    this.currentClient = client;
    this.scheduleNext();
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.currentClient = null;
    this.isScanning = false;
  }

  public async scanOnce(): Promise<void> {
    const client = this.currentClient;
    if (!this.enabled || !client || this.isScanning) {
      return;
    }

    this.isScanning = true;
    try {
      const chats = ((await client.getChats()) as WwebjsHistoryChat[])
        .filter((chat) => this.isSupportedUserChat(chat))
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, this.maxChatsPerCycle);

      for (const chat of chats) {
        if (this.currentClient !== client) {
          return;
        }

        await this.scanChat(chat);
      }
    } catch (error) {
      console.warn('[wwebjs] history reconciliation scan failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isScanning = false;
    }
  }

  private async scanChat(chat: WwebjsHistoryChat): Promise<void> {
    if (typeof chat.fetchMessages !== 'function') {
      return;
    }

    let messages: Message[] = [];
    try {
      messages = await chat.fetchMessages({ limit: this.messageLimit });
    } catch (error) {
      console.warn('[wwebjs] history reconciliation chat scan failed:', {
        chatId: this.getChatId(chat),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const orderedMessages = messages
      .filter((message) => !message.fromMe && this.isRecentMessage(message))
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    for (const message of orderedMessages) {
      await this.incomingMessageService.handleHistoryMessage(message);
    }
  }

  private scheduleNext(): void {
    if (!this.currentClient) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.scanOnce().finally(() => this.scheduleNext());
    }, this.computeJitteredDelayMs());
  }

  private computeJitteredDelayMs(): number {
    const jitterRatio = 0.8 + Math.random() * 0.4;
    return Math.max(1_000, Math.floor(this.intervalMs * jitterRatio));
  }

  private isSupportedUserChat(chat: WwebjsHistoryChat): boolean {
    if (chat.isGroup) {
      return false;
    }

    const id = this.getChatId(chat)?.toLowerCase();
    if (!id) {
      return false;
    }

    return (
      id !== 'status@broadcast' &&
      !id.endsWith('@g.us') &&
      !id.endsWith('@broadcast') &&
      !id.endsWith('@newsletter')
    );
  }

  private isRecentMessage(message: Message): boolean {
    const timestampMs = this.getMessageTimestampMs(message);
    return !!timestampMs && Date.now() - timestampMs <= this.maxAgeMs;
  }

  private getMessageTimestampMs(message: Message): number | null {
    const raw = message.timestamp;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  private getChatId(chat: WwebjsHistoryChat): string | null {
    if (typeof chat.id === 'string') {
      return chat.id;
    }

    return chat.id?._serialized ?? null;
  }
}
