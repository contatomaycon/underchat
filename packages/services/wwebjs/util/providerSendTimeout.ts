const DEFAULT_WWEBJS_SEND_MESSAGE_TIMEOUT_MS = 45_000;
const MIN_WWEBJS_SEND_MESSAGE_TIMEOUT_MS = 5_000;
const MAX_WWEBJS_SEND_MESSAGE_TIMEOUT_MS = 120_000;

export function resolveWwebjsSendMessageTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.WWEBJS_SEND_MESSAGE_TIMEOUT_MS ?? '',
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WWEBJS_SEND_MESSAGE_TIMEOUT_MS;
  }

  return Math.min(
    MAX_WWEBJS_SEND_MESSAGE_TIMEOUT_MS,
    Math.max(MIN_WWEBJS_SEND_MESSAGE_TIMEOUT_MS, parsed)
  );
}
