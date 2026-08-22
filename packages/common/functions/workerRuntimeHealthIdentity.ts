export function resolveWorkerRuntimeHealthWarmPoolIdentity(
  requestedWarmPoolId: string | undefined,
  runtimeWarmPoolId: string | undefined
): string {
  const requested = requestedWarmPoolId?.trim() ?? '';
  const runtime = runtimeWarmPoolId?.trim() ?? '';

  if (requested && requested !== runtime) {
    throw new Error('runtime_health_warm_pool_identity_mismatch');
  }

  return runtime;
}
