import { readonly, shallowRef } from 'vue';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const STORAGE_KEY = 'underchat:channel-migration-rollback:v1';

export interface ChannelMigrationRollbackContext {
  workerId: string;
  lifecycleOperationId: string;
  previousWorkerType: EWorkerType;
  previousServerId?: string;
  previousSessionStorage: EWorkerSessionStorage;
}

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim();
  return normalized || undefined;
};

const isWorkerType = (value: unknown): value is EWorkerType =>
  typeof value === 'string' &&
  (Object.values(EWorkerType) as string[]).includes(value);

const isSessionStorage = (value: unknown): value is EWorkerSessionStorage =>
  value === EWorkerSessionStorage.postgres ||
  value === EWorkerSessionStorage.legacy_volume;

const normalizeContext = (
  value: unknown
): ChannelMigrationRollbackContext | null => {
  if (!value || typeof value !== 'object') return null;

  const input = value as Record<string, unknown>;
  const workerId = nonEmptyString(input.workerId);
  const lifecycleOperationId = nonEmptyString(input.lifecycleOperationId);
  if (
    !workerId ||
    !lifecycleOperationId ||
    !isWorkerType(input.previousWorkerType) ||
    !isSessionStorage(input.previousSessionStorage)
  ) {
    return null;
  }

  return {
    workerId,
    lifecycleOperationId,
    previousWorkerType: input.previousWorkerType,
    previousServerId: nonEmptyString(input.previousServerId),
    previousSessionStorage: input.previousSessionStorage,
  };
};

const readStoredContext = (): ChannelMigrationRollbackContext | null => {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;

    return normalizeContext(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeStoredContext = (
  context: ChannelMigrationRollbackContext | null
) => {
  try {
    if (context) {
      globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(context));
      return;
    }

    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Session storage is only a convenience for recovering an in-flight UI.
    // The durable backend lifecycle remains authoritative when unavailable.
  }
};

/**
 * Keeps one in-flight channel migration recoverable across a browser reload.
 * It deliberately stores only the lifecycle fence and original routing
 * metadata — never session material — and every caller still verifies worker
 * + lifecycle operation against the authoritative channel row before offering
 * an action.
 */
export function useChannelMigrationRollbackContext() {
  const activeContext = shallowRef<ChannelMigrationRollbackContext | null>(
    readStoredContext()
  );

  const capture = (input: ChannelMigrationRollbackContext) => {
    const context = normalizeContext(input);
    if (!context) return null;

    activeContext.value = context;
    writeStoredContext(context);
    return context;
  };

  const clear = (expected?: {
    workerId: string;
    lifecycleOperationId: string;
  }) => {
    const current = activeContext.value;
    if (
      expected &&
      (!current ||
        current.workerId !== expected.workerId ||
        current.lifecycleOperationId !== expected.lifecycleOperationId)
    ) {
      return false;
    }

    activeContext.value = null;
    writeStoredContext(null);
    return true;
  };

  const matches = (input: {
    workerId?: string | null;
    lifecycleOperationId?: string | null;
  }): boolean => {
    const current = activeContext.value;
    return Boolean(
      current &&
      input.workerId === current.workerId &&
      input.lifecycleOperationId === current.lifecycleOperationId
    );
  };

  const restore = () => {
    activeContext.value = readStoredContext();
    return activeContext.value;
  };

  return {
    activeContext: readonly(activeContext),
    capture,
    clear,
    matches,
    restore,
  };
}
