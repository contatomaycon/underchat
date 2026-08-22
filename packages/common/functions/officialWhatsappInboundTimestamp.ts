const MAX_PROVIDER_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS = 60 * 1000;

export interface OfficialWhatsappInboundTimestampInput {
  providerTimestamp?: unknown;
  receivedAt?: string | Date | null;
  persistedAt?: string | Date | null;
  now?: string | Date;
}

export type OfficialWhatsappInboundTimestampSource =
  'provider' | 'received' | 'persisted' | 'now';

export interface OfficialWhatsappInboundTimestampResolution {
  timestamp: string;
  source: OfficialWhatsappInboundTimestampSource;
}

function dateTimestamp(value?: string | Date | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeOfficialWhatsappProviderTimestampMs(
  value: unknown
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const normalized =
    numeric > 1_000_000_000_000
      ? Math.floor(numeric)
      : Math.floor(numeric * 1000);
  return Number.isFinite(new Date(normalized).getTime()) ? normalized : null;
}

export function resolveOfficialWhatsappEffectMaxAgeMs(
  configuredValue: unknown
): number {
  const configured = Number(configuredValue);
  if (!Number.isFinite(configured) || configured <= 0) {
    return OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS;
  }
  return Math.min(
    Math.floor(configured),
    OFFICIAL_WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS
  );
}

export function resolveOfficialWhatsappFutureToleranceMs(
  configuredValue: unknown
): number {
  const configured = Number(configuredValue);
  if (!Number.isFinite(configured) || configured <= 0) {
    return OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS;
  }
  return Math.min(
    Math.floor(configured),
    OFFICIAL_WHATSAPP_PROVIDER_FUTURE_TOLERANCE_MS
  );
}

export interface OfficialWhatsappProviderEffectTimestampClassification {
  accepted: boolean;
  reason?: 'missing' | 'future' | 'stale';
  providerTimestampMs: number | null;
  ageMs: number | null;
}

export function classifyOfficialWhatsappProviderTimestampForEffects(input: {
  providerTimestamp: unknown;
  now?: number;
  maxAgeMs: number;
  futureToleranceMs: number;
}): OfficialWhatsappProviderEffectTimestampClassification {
  const providerTimestampMs = normalizeOfficialWhatsappProviderTimestampMs(
    input.providerTimestamp
  );
  if (providerTimestampMs === null) {
    return {
      accepted: false,
      reason: 'missing',
      providerTimestampMs: null,
      ageMs: null,
    };
  }

  const now = Number.isFinite(input.now) ? (input.now as number) : Date.now();
  const ageMs = now - providerTimestampMs;
  if (providerTimestampMs - now > input.futureToleranceMs) {
    return {
      accepted: false,
      reason: 'future',
      providerTimestampMs,
      ageMs,
    };
  }
  if (ageMs >= input.maxAgeMs) {
    return {
      accepted: false,
      reason: 'stale',
      providerTimestampMs,
      ageMs,
    };
  }
  return {
    accepted: true,
    providerTimestampMs,
    ageMs,
  };
}

/**
 * Resolves the canonical time of an inbound Meta message.
 *
 * The provider timestamp is authoritative for the 24-hour customer-service
 * window. Receipt and persistence timestamps are only fallbacks: webhook
 * retries, Kafka backlogs and replays must never turn an old customer message
 * into a fresh service window.
 */
export function resolveOfficialWhatsappInboundTimestampWithSource(
  input: OfficialWhatsappInboundTimestampInput
): OfficialWhatsappInboundTimestampResolution {
  const now = dateTimestamp(input.now) ?? Date.now();
  const provider = normalizeOfficialWhatsappProviderTimestampMs(
    input.providerTimestamp
  );
  const received = dateTimestamp(input.receivedAt);
  const persisted = dateTimestamp(input.persistedAt);
  const referenceTimestamp = Math.max(
    now,
    received ?? Number.NEGATIVE_INFINITY,
    persisted ?? Number.NEGATIVE_INFINITY
  );
  const maximumAcceptedTimestamp =
    referenceTimestamp + MAX_PROVIDER_FUTURE_SKEW_MS;
  const candidates: Array<{
    source: OfficialWhatsappInboundTimestampSource;
    value: number | null;
  }> = [
    { source: 'provider', value: provider },
    { source: 'received', value: received },
    { source: 'persisted', value: persisted },
    { source: 'now', value: now },
  ];
  const resolved = candidates.find(
    (candidate) =>
      candidate.value !== null && candidate.value <= maximumAcceptedTimestamp
  ) ?? { source: 'now' as const, value: now };

  return {
    timestamp: new Date(resolved.value ?? now).toISOString(),
    source: resolved.source,
  };
}

export function resolveOfficialWhatsappInboundTimestamp(
  input: OfficialWhatsappInboundTimestampInput
): string {
  return resolveOfficialWhatsappInboundTimestampWithSource(input).timestamp;
}

/** Returns a normalized provider event timestamp when Meta supplied one. */
export function resolveOfficialWhatsappProviderTimestamp(
  providerTimestampValue: unknown,
  referenceAt?: string | Date | null
): string | null {
  const resolution = resolveOfficialWhatsappInboundTimestampWithSource({
    providerTimestamp: providerTimestampValue,
    receivedAt: referenceAt,
  });

  if (resolution.source !== 'provider') {
    return null;
  }

  return resolution.timestamp;
}
