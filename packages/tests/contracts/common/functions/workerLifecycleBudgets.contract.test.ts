import {
  isWorkerLifecycleBudgetExhaustionError,
  resolveWorkerLifecycleBudgets,
  WORKER_RECREATE_SERVER_SLOT_HOLD_TIMEOUT_ERROR_NAME,
} from '@core/common/functions/workerLifecycleBudgets';

describe('worker lifecycle budgets', () => {
  it('derives safe defaults without requiring environment variables', () => {
    expect(resolveWorkerLifecycleBudgets({})).toEqual({
      slotWaitMs: 120_000,
      slotMaxHoldMs: 540_000,
      recreateConnectionConfirmationWaitMs: 60_000,
      sessionStorageMigrationConnectionConfirmationWaitMs: 240_000,
      sessionStorageMigrationAttemptMs: 540_000,
      providerHandoffConnectionConfirmationWaitMs: 300_000,
      grpcDeadlineMs: 720_000,
      pendingWatchdogMs: 780_000,
    });
  });

  it('floors every outer budget above the configured inner budgets', () => {
    expect(
      resolveWorkerLifecycleBudgets({
        WORKER_RECREATE_SERVER_SLOT_WAIT_MS: '180000',
        WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS: '360000',
        WORKER_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS: '180000',
        WORKER_LIFECYCLE_GRPC_DEADLINE_MS: '1000',
        KAFKA_WORKER_LIFECYCLE_STALL_MS: '1000',
      })
    ).toEqual({
      slotWaitMs: 180_000,
      slotMaxHoldMs: 540_000,
      recreateConnectionConfirmationWaitMs: 60_000,
      sessionStorageMigrationConnectionConfirmationWaitMs: 240_000,
      sessionStorageMigrationAttemptMs: 540_000,
      providerHandoffConnectionConfirmationWaitMs: 180_000,
      grpcDeadlineMs: 780_000,
      pendingWatchdogMs: 840_000,
    });
  });

  it('honors longer optional outer budgets and ignores invalid values', () => {
    expect(
      resolveWorkerLifecycleBudgets({
        WORKER_RECREATE_SERVER_SLOT_WAIT_MS: 'invalid',
        WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS: '-1',
        WORKER_LIFECYCLE_GRPC_DEADLINE_MS: '700000',
        KAFKA_WORKER_LIFECYCLE_STALL_MS: '800000',
      })
    ).toEqual({
      slotWaitMs: 120_000,
      slotMaxHoldMs: 540_000,
      recreateConnectionConfirmationWaitMs: 60_000,
      sessionStorageMigrationConnectionConfirmationWaitMs: 240_000,
      sessionStorageMigrationAttemptMs: 540_000,
      providerHandoffConnectionConfirmationWaitMs: 300_000,
      grpcDeadlineMs: 720_000,
      pendingWatchdogMs: 800_000,
    });
  });

  it('keeps the recreate slot above provider handoff confirmation plus startup grace', () => {
    const budgets = resolveWorkerLifecycleBudgets({
      WORKER_RECREATE_CONNECTION_CONFIRMATION_WAIT_MS: '420000',
      WORKER_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS: '300000',
      WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS: '360000',
    });

    expect(budgets.providerHandoffConnectionConfirmationWaitMs).toBe(420_000);
    expect(budgets.sessionStorageMigrationConnectionConfirmationWaitMs).toBe(
      420_000
    );
    expect(budgets.sessionStorageMigrationAttemptMs).toBe(900_000);
    expect(budgets.slotMaxHoldMs).toBe(900_000);
    expect(budgets.grpcDeadlineMs).toBe(1_080_000);
    expect(budgets.pendingWatchdogMs).toBe(1_140_000);
  });

  it('identifies only lifecycle budget exhaustion as fast-redrive terminal', () => {
    expect(isWorkerLifecycleBudgetExhaustionError({ code: 4 })).toBe(true);
    expect(isWorkerLifecycleBudgetExhaustionError({ code: '4' })).toBe(true);
    expect(
      isWorkerLifecycleBudgetExhaustionError({
        name: WORKER_RECREATE_SERVER_SLOT_HOLD_TIMEOUT_ERROR_NAME,
      })
    ).toBe(true);
    expect(isWorkerLifecycleBudgetExhaustionError({ code: 14 })).toBe(false);
    expect(isWorkerLifecycleBudgetExhaustionError(new Error('temporary'))).toBe(
      false
    );
  });
});
