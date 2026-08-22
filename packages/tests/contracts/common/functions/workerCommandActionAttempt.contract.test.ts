import { WorkerCommandActionAttemptRegistry } from '@core/common/functions/workerCommandActionAttempt';

describe('WorkerCommandActionAttemptRegistry', () => {
  it('keeps exactly the same operation after acceptance becomes unknown', () => {
    const createId = jest
      .fn<string, []>()
      .mockReturnValueOnce('operation-1')
      .mockReturnValueOnce('operation-2');
    const registry = new WorkerCommandActionAttemptRegistry(createId);

    const first = registry.begin('reaction:chat:message:👍');
    registry.settle('reaction:chat:message:👍', {
      status: 'unknown',
      operationId: first.operationId,
    });

    expect(registry.begin('reaction:chat:message:👍')).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it('allocates a new linked operation only on an explicit terminal retry', () => {
    const createId = jest
      .fn<string, []>()
      .mockReturnValueOnce('operation-1')
      .mockReturnValueOnce('operation-2');
    const registry = new WorkerCommandActionAttemptRegistry(createId);

    const first = registry.begin('delete:chat:message');
    registry.settle('delete:chat:message', {
      status: 'terminal',
      operationId: first.operationId,
    });

    expect(registry.begin('delete:chat:message')).toEqual({
      operationId: 'operation-2',
      retryOf: 'operation-1',
    });
  });

  it.each(['accepted', 'rejected'] as const)(
    'releases the attempt after a %s result',
    (status) => {
      const createId = jest
        .fn<string, []>()
        .mockReturnValueOnce('operation-1')
        .mockReturnValueOnce('operation-2');
      const registry = new WorkerCommandActionAttemptRegistry(createId);
      const first = registry.begin('edit:chat:message:text');

      registry.settle('edit:chat:message:text', {
        status,
        operationId: first.operationId,
      });

      expect(registry.begin('edit:chat:message:text')).toEqual({
        operationId: 'operation-2',
      });
    }
  );

  it('restores an unknown operation across navigation or process restart', () => {
    let nowMs = 1_000;
    const createId = jest
      .fn<string, []>()
      .mockReturnValueOnce('operation-1')
      .mockReturnValueOnce('operation-2');
    const firstRegistry = new WorkerCommandActionAttemptRegistry(
      createId,
      () => nowMs
    );
    const first = firstRegistry.begin('reaction:chat:message:👍');
    firstRegistry.settle('reaction:chat:message:👍', {
      status: 'unknown',
      operationId: first.operationId,
    });

    const restoredRegistry = new WorkerCommandActionAttemptRegistry(
      createId,
      () => nowMs
    );
    restoredRegistry.restore(firstRegistry.snapshot());

    expect(restoredRegistry.begin('reaction:chat:message:👍')).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);

    nowMs += 2 * 60 * 1000;
    expect(restoredRegistry.begin('reaction:chat:message:👍')).toEqual({
      operationId: 'operation-2',
      retryOf: 'operation-1',
    });
  });

  it('bounds durable attempts and drops only the oldest identities', () => {
    let sequence = 0;
    const registry = new WorkerCommandActionAttemptRegistry(
      () => `operation-${++sequence}`,
      () => sequence
    );

    for (let index = 0; index < 520; index += 1) {
      registry.begin(`delete:chat:message-${index}`);
    }

    const snapshot = registry.snapshot();
    expect(snapshot.attempts).toHaveLength(512);
    expect(snapshot.attempts[0]?.key).toBe('delete:chat:message-8');
    expect(snapshot.attempts.at(-1)?.key).toBe('delete:chat:message-519');
  });
});
