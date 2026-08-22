export type PlanEntitlementSource = 'plan' | 'addon' | null;

export interface PlanEntitlementResult {
  readonly accountId: string;
  readonly planProductId: string;
  readonly allowed: boolean;
  readonly revision: string;
  readonly validUntil: string | null;
  readonly planIsActive: boolean;
  readonly source: PlanEntitlementSource;
}

export interface PlanEntitlementReadOptions {
  readonly bypassCache?: boolean;
}

export interface PlanEntitlementAssertionOptions extends PlanEntitlementReadOptions {
  readonly expectedRevision?: string;
}
