import 'reflect-metadata';

import { WorkerCreationActivity } from '@core/jobs/activities/workerCreation.activities';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const input = {
  worker_id: 'worker-1',
  account_id: 'account-1',
  server_id: 'server-1',
  worker_status_id: EWorkerStatus.new,
  number: null,
  connection_date: null,
};

function makeSut(
  options: {
    claim?: () => Promise<boolean>;
    publish?: (payload: unknown) => Promise<void>;
  } = {}
) {
  const workerService = {
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: EWorkerType.baileys,
    })),
    updateWorkerByIdIfLifecycleMatches: jest.fn(
      options.claim ?? (async () => true)
    ),
    updateWorkerById: jest.fn(async () => true),
  };
  const workerLifecycleQueueService = {
    prepare: jest.fn(async () => undefined),
    publish: jest.fn(options.publish ?? (async () => undefined)),
  };
  const sut = new WorkerCreationActivity(
    workerService as never,
    workerLifecycleQueueService as never
  );
  return { sut, workerService, workerLifecycleQueueService };
}

describe('WorkerCreationActivity durable lifecycle boundary', () => {
  it('prepares the journal, wins an exact new-status CAS and only then publishes', async () => {
    const deps = makeSut();

    await deps.sut.processWorkerCreation(input);

    expect(deps.workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        worker_id: input.worker_id,
        account_id: input.account_id,
        server_id: input.server_id,
        worker_status_id: EWorkerStatus.creating,
        source: 'worker_create',
        operation_id: expect.any(String),
      })
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      input.account_id,
      expect.objectContaining({
        worker_id: input.worker_id,
        worker_status_id: EWorkerStatus.creating,
        lifecycle_operation_id: expect.any(String),
      }),
      {
        lifecycle_operation_id: null,
        server_id: input.server_id,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.new,
      }
    );
    expect(
      deps.workerLifecycleQueueService.prepare.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[0]
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    );
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('does not publish when the monitor wins the same new-status CAS', async () => {
    const deps = makeSut({ claim: async () => false });

    await deps.sut.processWorkerCreation(input);

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('preserves the creating operation and journal when Kafka remains unavailable', async () => {
    const kafkaError = new Error('Kafka unavailable');
    const deps = makeSut({
      publish: async () => {
        throw kafkaError;
      },
    });

    await expect(deps.sut.processWorkerCreation(input)).rejects.toBe(
      kafkaError
    );

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });
});
