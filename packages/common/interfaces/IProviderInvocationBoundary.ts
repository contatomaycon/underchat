export interface IProviderInvocationBoundary {
  (): Promise<void>;
  /**
   * Lightweight assignment/parent-operation fence used while optional work is
   * still running. The callable boundary remains the authoritative check
   * immediately before the provider invocation.
   */
  assertActive?: () => void;
  /**
   * Called only when the final synchronous pre-provider assertion rejects
   * after the async boundary resolved. Owners use it to reverse a confirmed
   * provider_invoked transition while it is still certain the SDK did not
   * start.
   */
  onStartRejected?: (error: unknown) => Promise<void>;
  isActive?: () => boolean;
  /** True while the owning message still has a registered send scope. */
  isRegistered?: () => boolean;
  /**
   * Optional outer deadline. Helpers reserve the provider timeout and only use
   * the remaining time for best-effort typing simulation.
   */
  deadlineAtMs?: number;
}
