import {
  recordWorkerCommandExecutionOutcome,
  runWithWorkerCommandExecutionOutcome,
} from '@core/common/functions/workerCommandExecutionOutcome';

describe('worker command execution outcome context', () => {
  it('keeps the highest-risk terminal outcome and isolates concurrent handlers', async () => {
    const [ambiguous, succeeded] = await Promise.all([
      runWithWorkerCommandExecutionOutcome(async () => {
        recordWorkerCommandExecutionOutcome('succeeded');
        await Promise.resolve();
        recordWorkerCommandExecutionOutcome('ambiguous');
        recordWorkerCommandExecutionOutcome('failed');
      }),
      runWithWorkerCommandExecutionOutcome(async () => {
        recordWorkerCommandExecutionOutcome('succeeded');
      }),
    ]);

    expect(ambiguous.outcome).toBe('ambiguous');
    expect(succeeded.outcome).toBe('succeeded');
  });

  it('does nothing outside an ingress execution context', () => {
    expect(() => recordWorkerCommandExecutionOutcome('failed')).not.toThrow();
  });
});
