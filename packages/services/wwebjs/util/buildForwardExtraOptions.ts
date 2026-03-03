import { IChatMessage } from '@core/common/interfaces/IChatMessage';

export type IWwebjsForwardExtraOptions = {
  isForwarded: true;
  forwardingScore: number;
};

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

export function buildForwardExtraOptions(
  data: IChatMessage
): IWwebjsForwardExtraOptions | undefined {
  const rawContext = data.content?.context_info as
    | Record<string, unknown>
    | null
    | undefined;

  if (!rawContext) {
    return undefined;
  }

  const rawScore =
    toPositiveInteger(rawContext.forwarding_score) ??
    toPositiveInteger(rawContext.forwardingScore) ??
    1;

  const isForwarded =
    rawContext.is_forwarded === true ||
    rawContext.isForwarded === true ||
    rawScore > 0;

  if (!isForwarded) {
    return undefined;
  }

  return {
    isForwarded: true,
    forwardingScore: Math.max(1, rawScore),
  };
}
