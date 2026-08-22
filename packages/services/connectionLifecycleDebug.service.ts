import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { sanitizeConnectionFlowFields } from '@core/common/functions/connectionFlowConsoleLog';

const DEBUG_GLOBAL_SEQUENCE_KEY = 'connection:lifecycle:debug:seq:global';
const DEBUG_TRACE_SEQUENCE_PREFIX = 'connection:lifecycle:debug:seq:trace';
const DEBUG_TRACE_SEQUENCE_TTL_SECONDS = 24 * 60 * 60;
const TRACE_HEADER = 'x-connection-lifecycle-debug-trace-id';

export interface ConnectionLifecycleDebugContext {
  trace_id?: string;
  layer?: string;
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  lifecycle_operation_id?: string;
  connection_attempt_id?: string;
  runtime_generation?: number | string;
  status?: string;
  code?: string | number;
  reason?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

let localGlobalSequence = 0;
const localTraceSequences = new Map<string, number>();

export function isConnectionLifecycleDebugEnabled(): boolean {
  return (
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED === 'true' ||
    process.env.WHATSAPP_SESSION_DEBUG_ENABLED === 'true'
  );
}

export function createConnectionLifecycleDebugTraceId(prefix = 'conn'): string {
  return `${prefix}_${randomUUID()}`;
}

export function extractConnectionLifecycleDebugTraceIdFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const value = headers[TRACE_HEADER] ?? headers[TRACE_HEADER.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((item) => item.trim().length > 0);
  }

  return value?.trim() || undefined;
}

@injectable()
export class ConnectionLifecycleDebugService {
  constructor(@inject('Redis') private readonly redis: Redis) {}

  async log(
    event: string,
    context: ConnectionLifecycleDebugContext = {}
  ): Promise<void> {
    if (!isConnectionLifecycleDebugEnabled()) {
      return;
    }

    const traceId = this.normalizeTraceId(context.trace_id);
    const sequence = await this.nextSequence(traceId);
    const sanitizedContext = this.sanitizeContext(context);
    if (sanitizedContext.event !== undefined) {
      sanitizedContext.source_event = sanitizedContext.event;
      delete sanitizedContext.event;
    }
    const payload = this.stabilizePayload({
      seq: sequence.seq,
      trace_seq: sequence.traceSeq,
      trace_id: traceId,
      event,
      layer: context.layer,
      timestamp: new Date().toISOString(),
      ...sanitizedContext,
    });

    console.log('[connection-lifecycle-debug]', JSON.stringify(payload));
  }

  private normalizeTraceId(traceId: unknown): string {
    if (typeof traceId === 'string' && traceId.trim()) {
      const candidate = traceId.trim();
      if (/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(candidate)) {
        return candidate;
      }
      return `trace_sha256_${createHash('sha256').update(candidate).digest('hex')}`;
    }

    return 'no-trace';
  }

  private async nextSequence(
    traceId: string
  ): Promise<{ seq: number; traceSeq: number }> {
    try {
      const traceKey = `${DEBUG_TRACE_SEQUENCE_PREFIX}:${traceId}`;
      const pipeline = this.redis.pipeline();
      pipeline.incr(DEBUG_GLOBAL_SEQUENCE_KEY);
      pipeline.incr(traceKey);
      pipeline.expire(traceKey, DEBUG_TRACE_SEQUENCE_TTL_SECONDS);
      const results = await pipeline.exec();
      const seq = Number(results?.[0]?.[1]);
      const traceSeq = Number(results?.[1]?.[1]);

      if (Number.isFinite(seq) && Number.isFinite(traceSeq)) {
        return { seq, traceSeq };
      }
    } catch {}

    localGlobalSequence += 1;
    const nextTraceSeq = (localTraceSequences.get(traceId) ?? 0) + 1;
    localTraceSequences.set(traceId, nextTraceSeq);

    return { seq: localGlobalSequence, traceSeq: nextTraceSeq };
  }

  private sanitizeContext(
    context: ConnectionLifecycleDebugContext
  ): Record<string, unknown> {
    const sanitized = sanitizeConnectionFlowFields(context);
    delete sanitized.trace_id;
    return sanitized;
  }

  private stabilizePayload(
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const stableKeys = [
      'seq',
      'trace_seq',
      'trace_id',
      'event',
      'layer',
      'worker_id',
      'account_id',
      'worker_type_id',
      'lifecycle_operation_id',
      'connection_attempt_id',
      'runtime_generation',
      'status',
      'code',
      'reason',
      'duration_ms',
      'timestamp',
    ];
    const output: Record<string, unknown> = {};

    for (const key of stableKeys) {
      if (payload[key] !== undefined) {
        output[key] = payload[key];
      }
    }

    for (const key of Object.keys(payload).sort()) {
      if (output[key] === undefined && payload[key] !== undefined) {
        output[key] = payload[key];
      }
    }

    return output;
  }
}
