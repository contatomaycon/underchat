let providerProcessReplacementRequired = false;

/**
 * A frozen WWebJS initialize call cannot be interrupted through the SDK
 * without overlapping Puppeteer protocol work. Keep the process fenced and
 * make Docker replacement sticky until a fresh process resets module state.
 */
export function markWwebjsProviderProcessReplacementRequired(): void {
  providerProcessReplacementRequired = true;
}

export function hasWwebjsProviderProcessReplacementRequirement(): boolean {
  return providerProcessReplacementRequired;
}
