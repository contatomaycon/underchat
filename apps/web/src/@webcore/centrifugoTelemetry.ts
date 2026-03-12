/**
 * Centrifugo Telemetry Module
 *
 * Lightweight telemetry for diagnosing Centrifugo WebSocket issues.
 * Accessible via window.__centrifugoTelemetry in browser devtools.
 *
 * Usage in devtools:
 *   window.__centrifugoTelemetry.getSnapshot()  // full metrics object
 *   window.__centrifugoTelemetry.getSummary()    // formatted text summary
 */

import { addEvent, recordException, recordMessage } from './observability';

interface CircularBuffer<T> {
  push(item: T): void;
  toArray(): T[];
  readonly length: number;
}

function createCircularBuffer<T>(maxSize: number): CircularBuffer<T> {
  const buffer: T[] = [];
  let head = 0;
  let count = 0;

  return {
    push(item: T) {
      if (count < maxSize) {
        buffer.push(item);
        count++;
      } else {
        buffer[head] = item;
        head = (head + 1) % maxSize;
      }
    },
    toArray(): T[] {
      if (count < maxSize) return buffer.slice();
      return [...buffer.slice(head), ...buffer.slice(0, head)];
    },
    get length() {
      return count;
    },
  };
}

interface SlidingWindowCounter {
  increment(): void;
  getCount(): number;
  getRate(): number;
}

function createSlidingWindowCounter(windowMs: number): SlidingWindowCounter {
  const timestamps: number[] = [];

  const prune = () => {
    const cutoff = Date.now() - windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
  };

  return {
    increment() {
      timestamps.push(Date.now());
      if (timestamps.length > 5000) prune();
    },
    getCount() {
      prune();
      return timestamps.length;
    },
    getRate() {
      prune();
      return timestamps.length / (windowMs / 1000);
    },
  };
}

export interface ConnectionStateEntry {
  state: string;
  timestamp: number;
  reason?: string;
  code?: number;
}

export interface SubscriptionStateEntry {
  state: string;
  timestamp: number;
  recovered?: boolean;
  wasRecovering?: boolean;
}

export interface BatchFlushEntry {
  timestamp: number;
  bufferSize: number;
  type: 'message' | 'chatUpdate';
}

export interface RecoveryAttemptEntry {
  channel: string;
  timestamp: number;
  success: boolean;
  messagesRecovered: number;
}

export interface HistorySyncEntry {
  channel: string;
  timestamp: number;
  messagesProcessed: number;
  pages: number;
  durationMs: number;
}

export interface TelemetryError {
  timestamp: number;
  context: string;
  error: string;
  channel?: string;
}

export interface VisibilityEntry {
  timestamp: number;
  state: 'visible' | 'hidden';
}

export interface ChannelPublicationMetrics {
  totalReceived: number;
  totalProcessed: number;
  totalDropped: number;
  ratePerSecond: SlidingWindowCounter;
}

export interface TelemetrySnapshot {
  connectionStateChanges: ConnectionStateEntry[];
  reconnectionCount: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  subscriptionStateChanges: Record<string, SubscriptionStateEntry[]>;
  publications: Record<
    string,
    {
      totalReceived: number;
      totalProcessed: number;
      totalDropped: number;
      ratePerSecond: number;
      countLast60s: number;
    }
  >;
  batchFlushes: BatchFlushEntry[];
  maxBufferSizeReached: { message: number; chatUpdate: number };
  recoveryAttempts: RecoveryAttemptEntry[];
  historySyncs: HistorySyncEntry[];
  errors: TelemetryError[];
  visibilityChanges: VisibilityEntry[];
  streamPositions: Record<string, { offset: number; epoch: string }>;
  uptimeMs: number;
}

export interface CentrifugoTelemetry {
  trackConnectionState(state: string, reason?: string, code?: number): void;
  trackSubscription(
    channel: string,
    state: string,
    ctx?: { recovered?: boolean; wasRecovering?: boolean }
  ): void;
  trackPublication(channel: string): void;
  trackPublicationProcessed(channel: string): void;
  trackPublicationDropped(channel: string, error: unknown): void;
  trackBatchFlush(type: 'message' | 'chatUpdate', bufferSize: number): void;
  trackRecovery(
    channel: string,
    success: boolean,
    messagesRecovered: number
  ): void;
  trackHistorySync(
    channel: string,
    messagesProcessed: number,
    pages: number,
    durationMs: number
  ): void;
  trackError(context: string, error: unknown, channel?: string): void;
  trackVisibility(state: 'visible' | 'hidden'): void;
  setStreamPositionProvider(
    provider: () => Map<string, { offset: number; epoch: string }>
  ): void;
  getSnapshot(): TelemetrySnapshot;
  getSummary(): string;
}

function createCentrifugoTelemetry(): CentrifugoTelemetry {
  const startTime = Date.now();

  const connectionStateChanges = createCircularBuffer<ConnectionStateEntry>(50);
  let reconnectionCount = 0;
  let lastConnectedAt: number | null = null;
  let lastDisconnectedAt: number | null = null;

  const subscriptionStateChanges = new Map<
    string,
    CircularBuffer<SubscriptionStateEntry>
  >();

  const publicationMetrics = new Map<string, ChannelPublicationMetrics>();

  const batchFlushes = createCircularBuffer<BatchFlushEntry>(100);
  const maxBufferSize = { message: 0, chatUpdate: 0 };

  const recoveryAttempts = createCircularBuffer<RecoveryAttemptEntry>(20);
  const historySyncs = createCircularBuffer<HistorySyncEntry>(20);
  const errors = createCircularBuffer<TelemetryError>(50);
  const visibilityChanges = createCircularBuffer<VisibilityEntry>(20);

  let streamPositionProvider:
    | (() => Map<string, { offset: number; epoch: string }>)
    | null = null;

  const getOrCreateChannelMetrics = (
    channel: string
  ): ChannelPublicationMetrics => {
    let metrics = publicationMetrics.get(channel);
    if (!metrics) {
      metrics = {
        totalReceived: 0,
        totalProcessed: 0,
        totalDropped: 0,
        ratePerSecond: createSlidingWindowCounter(60_000),
      };
      publicationMetrics.set(channel, metrics);
    }
    return metrics;
  };

  const getOrCreateSubBuffer = (
    channel: string
  ): CircularBuffer<SubscriptionStateEntry> => {
    let buffer = subscriptionStateChanges.get(channel);
    if (!buffer) {
      buffer = createCircularBuffer<SubscriptionStateEntry>(20);
      subscriptionStateChanges.set(channel, buffer);
    }
    return buffer;
  };

  const errorToString = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  };

  const telemetry: CentrifugoTelemetry = {
    trackConnectionState(state, reason?, code?) {
      const entry: ConnectionStateEntry = {
        state,
        timestamp: Date.now(),
        ...(reason && { reason }),
        ...(code !== undefined && { code }),
      };
      connectionStateChanges.push(entry);

      if (state === 'connected') {
        if (lastConnectedAt !== null) reconnectionCount++;
        lastConnectedAt = Date.now();
      } else if (state === 'disconnected') {
        lastDisconnectedAt = Date.now();
      }

      addEvent({
        category: 'centrifugo.connection',
        message: `Connection ${state}`,
        level:
          state === 'error'
            ? 'error'
            : state === 'disconnected'
              ? 'warn'
              : 'info',
        data: {
          state,
          reason,
          code,
          reconnectionCount,
        },
      });

      if (state === 'disconnected' || state === 'error') {
        recordMessage(`Centrifugo state: ${state}`, 'warn', {
          reason,
          code,
          reconnectionCount,
        });
      }
    },

    trackSubscription(channel, state, ctx?) {
      const buffer = getOrCreateSubBuffer(channel);
      buffer.push({
        state,
        timestamp: Date.now(),
        ...(ctx?.recovered !== undefined && { recovered: ctx.recovered }),
        ...(ctx?.wasRecovering !== undefined && {
          wasRecovering: ctx.wasRecovering,
        }),
      });

      if (state === 'recovery_failed') {
        recordMessage(`Centrifugo recovery failed: ${channel}`, 'warn', {
          centrifugo_channel: channel,
          recovered: ctx?.recovered,
          wasRecovering: ctx?.wasRecovering,
        });
      }

      addEvent({
        category: 'centrifugo.subscription',
        message: `Subscription ${state}: ${channel}`,
        level: state === 'recovery_failed' ? 'warn' : 'info',
        data: {
          channel,
          state,
          ...ctx,
        },
      });
    },

    trackPublication(channel) {
      const metrics = getOrCreateChannelMetrics(channel);
      metrics.totalReceived++;
      metrics.ratePerSecond.increment();
    },

    trackPublicationProcessed(channel) {
      const metrics = getOrCreateChannelMetrics(channel);
      metrics.totalProcessed++;
    },

    trackPublicationDropped(channel, error) {
      const metrics = getOrCreateChannelMetrics(channel);
      metrics.totalDropped++;
      errors.push({
        timestamp: Date.now(),
        context: 'publication_handler',
        error: errorToString(error),
        channel,
      });

      recordException(
        error instanceof Error ? error : new Error(errorToString(error)),
        {
          centrifugo_context: 'publication_dropped',
          centrifugo_channel: channel,
          totalDropped: metrics.totalDropped,
          totalReceived: metrics.totalReceived,
        }
      );
    },

    trackBatchFlush(type, bufferSize) {
      batchFlushes.push({ timestamp: Date.now(), bufferSize, type });
      if (type === 'message') {
        maxBufferSize.message = Math.max(maxBufferSize.message, bufferSize);
      } else {
        maxBufferSize.chatUpdate = Math.max(
          maxBufferSize.chatUpdate,
          bufferSize
        );
      }
    },

    trackRecovery(channel, success, messagesRecovered) {
      recoveryAttempts.push({
        channel,
        timestamp: Date.now(),
        success,
        messagesRecovered,
      });

      addEvent({
        category: 'centrifugo.recovery',
        message: `Recovery ${success ? 'succeeded' : 'failed'}: ${channel}`,
        level: success ? 'info' : 'warn',
        data: {
          channel,
          success,
          messagesRecovered,
        },
      });

      if (!success) {
        recordMessage(`Centrifugo recovery failed: ${channel}`, 'warn', {
          centrifugo_channel: channel,
          messagesRecovered,
        });
      }
    },

    trackHistorySync(channel, messagesProcessed, pages, durationMs) {
      historySyncs.push({
        channel,
        timestamp: Date.now(),
        messagesProcessed,
        pages,
        durationMs,
      });

      addEvent({
        category: 'centrifugo.history_sync',
        message: `History sync: ${channel} (${messagesProcessed} msgs, ${pages} pages, ${durationMs}ms)`,
        level: 'info',
        data: {
          channel,
          messagesProcessed,
          pages,
          durationMs,
        },
      });
    },

    trackError(context, error, channel?) {
      const entry: TelemetryError = {
        timestamp: Date.now(),
        context,
        error: errorToString(error),
        ...(channel && { channel }),
      };
      errors.push(entry);

      recordException(
        error instanceof Error ? error : new Error(errorToString(error)),
        {
          centrifugo_context: context,
          ...(channel && { centrifugo_channel: channel }),
        }
      );

      recordMessage(`Centrifugo telemetry error: ${context}`, 'error', {
        channel,
        error: errorToString(error),
      });
    },

    trackVisibility(state) {
      visibilityChanges.push({ timestamp: Date.now(), state });

      addEvent({
        category: 'centrifugo.visibility',
        message: `Tab ${state}`,
        level: 'info',
        data: {
          state,
        },
      });
    },

    setStreamPositionProvider(provider) {
      streamPositionProvider = provider;
    },

    getSnapshot(): TelemetrySnapshot {
      const subChanges: Record<string, SubscriptionStateEntry[]> = {};
      for (const [ch, buf] of subscriptionStateChanges) {
        subChanges[ch] = buf.toArray();
      }

      const pubs: TelemetrySnapshot['publications'] = {};
      for (const [ch, m] of publicationMetrics) {
        pubs[ch] = {
          totalReceived: m.totalReceived,
          totalProcessed: m.totalProcessed,
          totalDropped: m.totalDropped,
          ratePerSecond: Math.round(m.ratePerSecond.getRate() * 100) / 100,
          countLast60s: m.ratePerSecond.getCount(),
        };
      }

      const positions: Record<string, { offset: number; epoch: string }> = {};
      if (streamPositionProvider) {
        for (const [ch, pos] of streamPositionProvider()) {
          positions[ch] = { ...pos };
        }
      }

      return {
        connectionStateChanges: connectionStateChanges.toArray(),
        reconnectionCount,
        lastConnectedAt,
        lastDisconnectedAt,
        subscriptionStateChanges: subChanges,
        publications: pubs,
        batchFlushes: batchFlushes.toArray(),
        maxBufferSizeReached: { ...maxBufferSize },
        recoveryAttempts: recoveryAttempts.toArray(),
        historySyncs: historySyncs.toArray(),
        errors: errors.toArray(),
        visibilityChanges: visibilityChanges.toArray(),
        streamPositions: positions,
        uptimeMs: Date.now() - startTime,
      };
    },

    getSummary(): string {
      const snap = this.getSnapshot();
      const lines: string[] = [
        '=== Centrifugo Telemetry Summary ===',
        `Uptime: ${Math.round(snap.uptimeMs / 1000)}s`,
        `Reconnections: ${snap.reconnectionCount}`,
        `Last connected: ${snap.lastConnectedAt ? new Date(snap.lastConnectedAt).toISOString() : 'never'}`,
        `Last disconnected: ${snap.lastDisconnectedAt ? new Date(snap.lastDisconnectedAt).toISOString() : 'never'}`,
        '',
        '--- Publications ---',
      ];

      for (const [ch, m] of Object.entries(snap.publications)) {
        lines.push(
          `  ${ch}: recv=${m.totalReceived} proc=${m.totalProcessed} drop=${m.totalDropped} rate=${m.ratePerSecond}/s (last 60s: ${m.countLast60s})`
        );
      }

      lines.push('', '--- Batch Flushes (last 10) ---');
      const recentFlushes = snap.batchFlushes.slice(-10);
      for (const f of recentFlushes) {
        lines.push(
          `  ${new Date(f.timestamp).toISOString()} ${f.type} size=${f.bufferSize}`
        );
      }
      lines.push(
        `  Max buffer: message=${snap.maxBufferSizeReached.message} chatUpdate=${snap.maxBufferSizeReached.chatUpdate}`
      );

      lines.push('', '--- Recovery Attempts (last 5) ---');
      const recentRecovery = snap.recoveryAttempts.slice(-5);
      for (const r of recentRecovery) {
        lines.push(
          `  ${new Date(r.timestamp).toISOString()} ${r.channel} success=${r.success} msgs=${r.messagesRecovered}`
        );
      }

      lines.push('', '--- History Syncs (last 5) ---');
      const recentSyncs = snap.historySyncs.slice(-5);
      for (const s of recentSyncs) {
        lines.push(
          `  ${new Date(s.timestamp).toISOString()} ${s.channel} msgs=${s.messagesProcessed} pages=${s.pages} ${s.durationMs}ms`
        );
      }

      lines.push('', '--- Errors (last 10) ---');
      const recentErrors = snap.errors.slice(-10);
      for (const e of recentErrors) {
        lines.push(
          `  ${new Date(e.timestamp).toISOString()} [${e.context}] ${e.error}${e.channel ? ` (${e.channel})` : ''}`
        );
      }

      lines.push('', '--- Stream Positions ---');
      for (const [ch, pos] of Object.entries(snap.streamPositions)) {
        lines.push(`  ${ch}: offset=${pos.offset} epoch=${pos.epoch}`);
      }

      return lines.join('\n');
    },
  };

  return telemetry;
}

let instance: CentrifugoTelemetry | null = null;

export const getCentrifugoTelemetry = (): CentrifugoTelemetry => {
  if (!instance) {
    instance = createCentrifugoTelemetry();

    if (typeof window !== 'undefined') {
      (window as any).__centrifugoTelemetry = instance;
    }
  }
  return instance;
};

export const resetCentrifugoTelemetry = (): void => {
  instance = null;
  if (typeof window !== 'undefined') {
    delete (window as any).__centrifugoTelemetry;
  }
};
