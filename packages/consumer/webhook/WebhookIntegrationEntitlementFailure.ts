export class WebhookIntegrationEntitlementUnavailableError extends Error {
  public readonly reason = 'plan_entitlement_unavailable' as const;

  constructor(
    public readonly stage: 'received' | 'publish',
    public readonly cause: unknown
  ) {
    super(`Integration entitlement verification failed at ${stage}`);
    this.name = 'WebhookIntegrationEntitlementUnavailableError';
  }
}

export function isWebhookIntegrationEntitlementUnavailableError(
  error: unknown
): error is WebhookIntegrationEntitlementUnavailableError {
  return error instanceof WebhookIntegrationEntitlementUnavailableError;
}
