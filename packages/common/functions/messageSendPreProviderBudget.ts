import { MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS } from './downloadMediaBuffer';
import { resolveTypingSimulationMaxDelayMs } from './typingSimulationConfig';

export const MESSAGE_SEND_PRE_PROVIDER_SAFETY_MARGIN_MS = 10_000;
export const MESSAGE_SEND_RESERVATION_LEASE_MARGIN_MS = 30_000;

interface IMessageSendPreProviderBudgetInput {
  providerTimeoutMs: number;
  preparationTimeoutMs?: number;
  typingSimulationMaxDelayMs?: number;
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Keeps the pre-provider watchdog and optional typing work on one clock.
 *
 * The provider timeout is intentionally reserved because typing helpers
 * subtract it from `boundary.deadlineAtMs`. This is a hardcoded protocol
 * budget: environment drift must not change the execution boundary.
 */
export function resolveMessageSendPreProviderTimeoutMs(
  input: IMessageSendPreProviderBudgetInput
): number {
  const typingSimulationMaxDelayMs = positiveFinite(
    input.typingSimulationMaxDelayMs,
    resolveTypingSimulationMaxDelayMs()
  );
  const providerTimeoutMs = positiveFinite(input.providerTimeoutMs, 45_000);
  const preparationTimeoutMs = positiveFinite(
    input.preparationTimeoutMs,
    MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS
  );
  const derivedFloorMs =
    typingSimulationMaxDelayMs +
    providerTimeoutMs +
    preparationTimeoutMs +
    MESSAGE_SEND_PRE_PROVIDER_SAFETY_MARGIN_MS;
  return derivedFloorMs;
}

export function resolveMessageSendReservationLeaseMs(
  preProviderTimeoutMs: number,
  maximumLeaseMs: number
): number {
  const normalizedPreProviderTimeoutMs = positiveFinite(
    preProviderTimeoutMs,
    30_000
  );
  const normalizedMaximumLeaseMs = positiveFinite(maximumLeaseMs, 600_000);

  return Math.min(
    normalizedMaximumLeaseMs,
    normalizedPreProviderTimeoutMs + MESSAGE_SEND_RESERVATION_LEASE_MARGIN_MS
  );
}
