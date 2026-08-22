export interface PlanEntitlementErrorContext {
  readonly accountId: string;
  readonly planProductId: string;
  readonly allowed: boolean;
  readonly revision: string;
}

export const PLAN_ENTITLEMENT_DENY_FENCE_REQUIRED_SQLSTATE = 'UC001';
export const PLAN_ENTITLEMENT_DENY_FENCE_REQUIRED_MESSAGE =
  'plan_entitlement_deny_fence_required';

export const isPlanEntitlementDenyFenceRequiredError = (
  error: unknown
): boolean => {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (typeof current !== 'object') return false;
    const value = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      value.code === PLAN_ENTITLEMENT_DENY_FENCE_REQUIRED_SQLSTATE ||
      (typeof value.message === 'string' &&
        value.message.includes(PLAN_ENTITLEMENT_DENY_FENCE_REQUIRED_MESSAGE))
    ) {
      return true;
    }
    current = value.cause;
  }
  return false;
};

export class PlanEntitlementDeniedError extends Error {
  public readonly reason = 'plan_product_required' as const;

  constructor(public readonly entitlement: PlanEntitlementErrorContext) {
    super(`Plan product ${entitlement.planProductId} is not available`);
    this.name = 'PlanEntitlementDeniedError';
  }
}

export class PlanEntitlementRevisionMismatchError extends Error {
  public readonly reason = 'plan_entitlement_revision_mismatch' as const;

  constructor(
    public readonly entitlement: PlanEntitlementErrorContext,
    public readonly expectedRevision: string
  ) {
    super(
      `Plan entitlement revision mismatch: expected ${expectedRevision}, received ${entitlement.revision}`
    );
    this.name = 'PlanEntitlementRevisionMismatchError';
  }
}

export class PlanEntitlementUnavailableError extends Error {
  public readonly reason = 'plan_entitlement_unavailable' as const;

  constructor(
    message = 'Plan entitlement could not be resolved',
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PlanEntitlementUnavailableError';
  }
}
