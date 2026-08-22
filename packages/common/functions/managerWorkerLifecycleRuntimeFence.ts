import {
  compareWorkerLifecycleOperationIds,
  normalizeWorkerLifecycleOperationId,
  normalizeWorkerLifecycleRuntimeGeneration,
} from './workerLifecycleRealtimeStatus';

export type ManagerWorkerLifecycleRuntimeFence = ReturnType<
  typeof createManagerWorkerLifecycleRuntimeFence
>;

/**
 * Keeps every provider publication behind an active manager lifecycle
 * operation. Only the exact manager completion may release the fence; native
 * status ordering continues to validate subsequent events afterwards.
 */
export function createManagerWorkerLifecycleRuntimeFence() {
  const operationByWorker = new Map<string, string>();
  const completedOperationByWorker = new Map<string, string>();

  return {
    /**
     * Mirrors an already validated HTTP/shared-reducer snapshot into this
     * side-effect fence. Callers must not use raw publication fields here: the
     * purpose is to keep legacy dashboard mutations aligned with the canonical
     * presentation reducer when `started` was absent from local history.
     */
    synchronizeAuthoritativeState(input: {
      workerId: string;
      activeOperationId?: unknown;
      completedOperationId?: unknown;
    }): boolean {
      const activeOperationId =
        input.activeOperationId === null ||
        input.activeOperationId === undefined
          ? undefined
          : normalizeWorkerLifecycleOperationId(input.activeOperationId);
      const completedOperationId =
        input.completedOperationId === null ||
        input.completedOperationId === undefined
          ? undefined
          : normalizeWorkerLifecycleOperationId(input.completedOperationId);
      if (
        (input.activeOperationId !== null &&
          input.activeOperationId !== undefined &&
          !activeOperationId) ||
        (input.completedOperationId !== null &&
          input.completedOperationId !== undefined &&
          !completedOperationId) ||
        (activeOperationId && activeOperationId === completedOperationId)
      ) {
        return false;
      }

      if (activeOperationId) {
        operationByWorker.set(input.workerId, activeOperationId);
      } else {
        operationByWorker.delete(input.workerId);
      }
      if (completedOperationId) {
        completedOperationByWorker.set(input.workerId, completedOperationId);
      } else {
        completedOperationByWorker.delete(input.workerId);
      }
      return true;
    },
    remember(
      workerId: string,
      operationId: string,
      completedProof?: {
        operationId?: unknown;
        runtimeGeneration?: unknown;
        completedAt?: unknown;
      }
    ): boolean {
      const normalizedOperationId =
        normalizeWorkerLifecycleOperationId(operationId);
      const completedOperationId = completedOperationByWorker.get(workerId);
      if (!normalizedOperationId) return false;
      if (completedOperationId) {
        const comparison = compareWorkerLifecycleOperationIds(
          normalizedOperationId,
          completedOperationId
        );
        const exactCompletedProof = Boolean(
          normalizeWorkerLifecycleOperationId(completedProof?.operationId) ===
            completedOperationId &&
          normalizeWorkerLifecycleRuntimeGeneration(
            completedProof?.runtimeGeneration
          ) &&
          typeof completedProof?.completedAt === 'string' &&
          Number.isFinite(Date.parse(completedProof.completedAt))
        );
        if (
          comparison === 0 ||
          comparison === -1 ||
          (comparison === undefined && !exactCompletedProof)
        ) {
          return false;
        }
      }
      operationByWorker.set(workerId, normalizedOperationId);
      return true;
    },
    forget(workerId: string): void {
      operationByWorker.delete(workerId);
      completedOperationByWorker.delete(workerId);
    },
    currentOperation(workerId: string): string | undefined {
      return operationByWorker.get(workerId);
    },
    hasActiveOperation(workerId: string): boolean {
      return operationByWorker.has(workerId);
    },
    lastCompletedOperation(workerId: string): string | undefined {
      return completedOperationByWorker.get(workerId);
    },
    complete(input: {
      workerId: string;
      operationId?: unknown;
      persistedRuntimeGeneration?: unknown;
      eventRuntimeGeneration?: unknown;
    }): boolean {
      const currentOperationId = normalizeWorkerLifecycleOperationId(
        operationByWorker.get(input.workerId)
      );
      const completionOperationId = normalizeWorkerLifecycleOperationId(
        input.operationId
      );
      const persistedRuntimeGeneration =
        normalizeWorkerLifecycleRuntimeGeneration(
          input.persistedRuntimeGeneration
        );
      const eventRuntimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
        input.eventRuntimeGeneration
      );
      if (
        !currentOperationId ||
        !completionOperationId ||
        completionOperationId !== currentOperationId ||
        !persistedRuntimeGeneration ||
        !eventRuntimeGeneration ||
        eventRuntimeGeneration < persistedRuntimeGeneration
      ) {
        return false;
      }

      operationByWorker.delete(input.workerId);
      completedOperationByWorker.set(input.workerId, completionOperationId);
      return true;
    },
    acceptProviderRuntime(input: {
      workerId: string;
      persistedRuntimeGeneration?: unknown;
      eventRuntimeGeneration?: unknown;
    }): boolean {
      if (!operationByWorker.has(input.workerId)) {
        return true;
      }

      return false;
    },
  };
}
