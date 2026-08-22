import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { singleton } from 'tsyringe';

type DeliveryOutcome = 'sent' | 'failed';
export type DeliveryWaitResult = DeliveryOutcome | 'timeout';
type DeliveryListener = (outcome: DeliveryOutcome) => void;

interface IOutcomeCacheEntry {
  outcome: DeliveryOutcome;
  expiresAt: number;
}

@singleton()
export class WwebjsDeliveryConfirmationService {
  private readonly pending = new Map<string, Set<DeliveryListener>>();
  private readonly cache = new Map<string, IOutcomeCacheEntry>();
  private readonly outcomeTtlMs = 120_000;
  private readonly defaultWaitTimeoutMs = 20_000;

  async waitForOutcome(
    messageId: string,
    timeoutMs = this.defaultWaitTimeoutMs
  ): Promise<DeliveryWaitResult> {
    const messageIdAliases = this.getMessageIdAliases(messageId);
    if (!messageIdAliases.length) {
      return 'timeout';
    }

    this.cleanupExpiredCache();

    const cachedOutcome = this.getCachedOutcome(messageIdAliases);
    if (cachedOutcome) {
      return cachedOutcome;
    }

    return new Promise<DeliveryWaitResult>((resolve) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const registeredListeners = new Set<DeliveryListener>();

      const removeListener = (listener: DeliveryListener) => {
        for (const messageIdAlias of messageIdAliases) {
          const listeners = this.pending.get(messageIdAlias);
          if (!listeners) {
            continue;
          }

          listeners.delete(listener);
          if (listeners.size === 0) {
            this.pending.delete(messageIdAlias);
          }
        }
      };

      const finish = (result: DeliveryWaitResult) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        for (const listener of registeredListeners) {
          removeListener(listener);
        }
        registeredListeners.clear();
        resolve(result);
      };

      const deliver: DeliveryListener = (outcome) => {
        finish(outcome);
      };
      registeredListeners.add(deliver);

      timeoutHandle = setTimeout(() => {
        finish('timeout');
      }, timeoutMs);

      for (const messageIdAlias of messageIdAliases) {
        const listeners =
          this.pending.get(messageIdAlias) ?? new Set<DeliveryListener>();
        listeners.add(deliver);
        this.pending.set(messageIdAlias, listeners);
      }
    });
  }

  markSent(messageId: string): boolean {
    return this.markOutcome(messageId, 'sent');
  }

  markFailed(messageId: string): boolean {
    return this.markOutcome(messageId, 'failed');
  }

  private markOutcome(messageId: string, outcome: DeliveryOutcome): boolean {
    const messageIdAliases = this.getMessageIdAliases(messageId);
    if (!messageIdAliases.length) {
      return false;
    }

    this.cleanupExpiredCache();

    if (
      outcome === 'failed' &&
      this.getCachedOutcome(messageIdAliases) === 'sent'
    ) {
      return false;
    }

    const expiresAt = Date.now() + this.outcomeTtlMs;
    for (const messageIdAlias of messageIdAliases) {
      this.cache.set(messageIdAlias, {
        outcome,
        expiresAt,
      });
    }

    const listenersToNotify = new Set<DeliveryListener>();
    for (const messageIdAlias of messageIdAliases) {
      const listeners = this.pending.get(messageIdAlias);
      if (!listeners) {
        continue;
      }

      this.pending.delete(messageIdAlias);
      for (const listener of listeners) {
        listenersToNotify.add(listener);
      }
    }

    for (const listener of listenersToNotify) {
      listener(outcome);
    }

    return true;
  }

  private getCachedOutcome(
    messageIdAliases: string[]
  ): DeliveryOutcome | undefined {
    let hasFailedOutcome = false;

    for (const messageIdAlias of messageIdAliases) {
      const cached = this.cache.get(messageIdAlias);
      if (cached?.outcome === 'sent') {
        return 'sent';
      }
      if (cached?.outcome === 'failed') {
        hasFailedOutcome = true;
      }
    }

    return hasFailedOutcome ? 'failed' : undefined;
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [messageId, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(messageId);
      }
    }
  }

  private getMessageIdAliases(messageId: string): string[] {
    const normalized = messageId?.trim();
    if (!normalized) {
      return [];
    }

    const aliases = new Set<string>([normalized]);
    const parsed = parseSerializedMessageId(normalized);
    if (parsed?.stanzaId) {
      aliases.add(parsed.stanzaId);
    }

    return Array.from(aliases);
  }
}
