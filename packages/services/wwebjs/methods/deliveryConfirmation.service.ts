import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { singleton } from 'tsyringe';

type DeliveryOutcome = 'sent' | 'failed';
export type DeliveryWaitResult = DeliveryOutcome | 'timeout';

interface IOutcomeCacheEntry {
  outcome: DeliveryOutcome;
  expiresAt: number;
}

@singleton()
export class WwebjsDeliveryConfirmationService {
  private readonly pending = new Map<
    string,
    Set<(outcome: DeliveryOutcome) => void>
  >();
  private readonly cache = new Map<string, IOutcomeCacheEntry>();
  private readonly outcomeTtlMs = 120_000;
  private readonly defaultWaitTimeoutMs = 20_000;

  async waitForOutcome(
    messageId: string,
    timeoutMs = this.defaultWaitTimeoutMs
  ): Promise<DeliveryWaitResult> {
    const normalizedMessageId = this.normalizeMessageId(messageId);
    if (!normalizedMessageId) {
      return 'timeout';
    }

    this.cleanupExpiredCache();

    const cached = this.cache.get(normalizedMessageId);
    if (cached) {
      return cached.outcome;
    }

    return new Promise<DeliveryWaitResult>((resolve) => {
      let timeoutHandle: NodeJS.Timeout | undefined;

      const deliver = (outcome: DeliveryOutcome) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve(outcome);
      };

      timeoutHandle = setTimeout(() => {
        const listeners = this.pending.get(normalizedMessageId);
        if (listeners) {
          listeners.delete(deliver);
          if (listeners.size === 0) {
            this.pending.delete(normalizedMessageId);
          }
        }
        resolve('timeout');
      }, timeoutMs);

      const listeners =
        this.pending.get(normalizedMessageId) ??
        new Set<(outcome: DeliveryOutcome) => void>();
      listeners.add(deliver);
      this.pending.set(normalizedMessageId, listeners);
    });
  }

  markSent(messageId: string): void {
    this.markOutcome(messageId, 'sent');
  }

  markFailed(messageId: string): void {
    this.markOutcome(messageId, 'failed');
  }

  private markOutcome(messageId: string, outcome: DeliveryOutcome): void {
    const normalizedMessageId = this.normalizeMessageId(messageId);
    if (!normalizedMessageId) {
      return;
    }

    this.cache.set(normalizedMessageId, {
      outcome,
      expiresAt: Date.now() + this.outcomeTtlMs,
    });

    const listeners = this.pending.get(normalizedMessageId);
    if (!listeners) {
      return;
    }

    this.pending.delete(normalizedMessageId);
    for (const listener of listeners) {
      listener(outcome);
    }
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [messageId, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(messageId);
      }
    }
  }

  private normalizeMessageId(messageId: string): string | null {
    const normalized = messageId?.trim();
    if (!normalized) {
      return null;
    }

    const parsed = parseSerializedMessageId(normalized);
    return parsed?.stanzaId ?? normalized;
  }
}
