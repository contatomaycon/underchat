export type WwebjsRuntimeSafetyReason =
  'image_mismatch' | 'pids_limit_missing' | 'tini_missing';

const WWEBJS_REQUIRED_INIT_ENTRYPOINT = '/usr/bin/tini';

export function getWwebjsRuntimeSafetyReasons(input: {
  currentContentId: string | undefined;
  entrypoint: readonly string[] | undefined;
  expectedContentId: string;
  pidsLimit: number | null | undefined;
}): WwebjsRuntimeSafetyReason[] {
  const reasons: WwebjsRuntimeSafetyReason[] = [];
  if (
    input.currentContentId?.trim().toLowerCase() !==
    input.expectedContentId.trim().toLowerCase()
  ) {
    reasons.push('image_mismatch');
  }
  if (input.entrypoint?.[0] !== WWEBJS_REQUIRED_INIT_ENTRYPOINT) {
    reasons.push('tini_missing');
  }
  if (!Number.isSafeInteger(input.pidsLimit) || Number(input.pidsLimit) <= 0) {
    reasons.push('pids_limit_missing');
  }
  return reasons;
}
