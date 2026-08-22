import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

import { ProfileStatusExternalIdUpdateConsume } from '@core/consumer/worker/ProfileStatusExternalIdUpdate.consume';
import { StaleWhatsappRuntimeDatabaseFenceError } from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

function makeConsumer(isCurrent: boolean | Error) {
  const effectLease = {
    assertOwned: jest.fn(),
    release: jest.fn(async () => true),
  };
  const workerProfileStatusService = {
    updateExternalId: jest.fn(async () => true),
  };
  const runtimeFence = {
    isCurrent: jest.fn(async () => {
      if (isCurrent instanceof Error) {
        throw isCurrent;
      }
      return isCurrent;
    }),
    viewAdmissionState: jest.fn(async (workerId: string) => ({
      state: 'active' as const,
      fence: {
        worker_id: workerId,
        source_provider: 'baileys',
        runtime_generation: 10,
        connection_epoch: 'connection-10',
        connection_sequence: 2,
        activated_at: Date.now(),
        state: 'active' as const,
        activation_order: 2,
      },
    })),
    acquireEffectLease: jest.fn(async () => effectLease),
  };
  const consumer = new ProfileStatusExternalIdUpdateConsume(
    {} as never,
    {
      updateProfileStatusExternalId: jest.fn(
        () => 'update.profile.status.external.id'
      ),
    } as never,
    workerProfileStatusService as never,
    runtimeFence as never
  );

  return {
    consumer,
    runtimeFence,
    workerProfileStatusService,
    effectLease,
  };
}

const event = {
  worker_profile_status_id: 'profile-status-1',
  external_id: 'external-status-1',
  event_id:
    'profile-status-external-id:v1:account-1:worker-1:profile-status-1:external-status-1',
  account_id: 'account-1',
  worker_id: 'worker-1',
  source_provider: 'whatsmeow',
  runtime_generation: 9,
  connection_epoch: 'connection-9',
};

describe('ProfileStatusExternalIdUpdateConsume runtime fencing', () => {
  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'rebinds a durable %s profile result to the active generation without changing immutable identity',
    async (provider) => {
      const { consumer, runtimeFence, workerProfileStatusService } =
        makeConsumer(true);
      runtimeFence.viewAdmissionState.mockResolvedValueOnce({
        state: 'active',
        fence: {
          worker_id: 'worker-1',
          source_provider: provider,
          runtime_generation: 10,
          connection_epoch: `${provider}-connection-10`,
          connection_sequence: 2,
          activated_at: Date.now(),
          state: 'active',
          activation_order: 2,
        },
      });
      const rotatedEvent = {
        ...event,
        source_provider: provider,
      };
      const stableIdentity = {
        event_id: rotatedEvent.event_id,
        account_id: rotatedEvent.account_id,
        worker_id: rotatedEvent.worker_id,
        worker_profile_status_id: rotatedEvent.worker_profile_status_id,
        external_id: rotatedEvent.external_id,
      };

      await expect(
        (consumer as any).acquireRuntimeEffectLease(rotatedEvent)
      ).resolves.toBeDefined();
      await (consumer as any).processUpdate(rotatedEvent, jest.fn(), true);

      expect(rotatedEvent).toMatchObject({
        ...stableIdentity,
        source_provider: provider,
        runtime_generation: 10,
        connection_epoch: `${provider}-connection-10`,
      });
      expect(runtimeFence.acquireEffectLease).toHaveBeenCalledWith(
        rotatedEvent
      );
      expect(runtimeFence.isCurrent).not.toHaveBeenCalled();
      expect(workerProfileStatusService.updateExternalId).toHaveBeenCalledWith(
        'profile-status-1',
        'external-status-1',
        expect.objectContaining({
          account_id: 'account-1',
          worker_id: 'worker-1',
          source_provider: provider,
          runtime_generation: 10,
          connection_epoch: `${provider}-connection-10`,
        })
      );
    }
  );

  it('fails closed before scope capture when the durable event identity is forged', async () => {
    const { consumer, runtimeFence, workerProfileStatusService } =
      makeConsumer(true);

    await expect(
      (consumer as any).acquireRuntimeEffectLease({
        ...event,
        source_provider: 'baileys',
        event_id: 'forged-profile-event',
      })
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
      reason: 'auxiliary_runtime_event_unrecoverable',
    });

    expect(runtimeFence.viewAdmissionState).not.toHaveBeenCalled();
    expect(workerProfileStatusService.updateExternalId).not.toHaveBeenCalled();
  });

  it('updates only while the provider runtime is still current', async () => {
    const { consumer, runtimeFence, workerProfileStatusService } =
      makeConsumer(true);
    const assertActive = jest.fn();

    await (consumer as any).processUpdate(event, assertActive);

    expect(runtimeFence.isCurrent).toHaveBeenCalledWith(event);
    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(workerProfileStatusService.updateExternalId).toHaveBeenCalledWith(
      'profile-status-1',
      'external-status-1',
      {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'whatsmeow',
        runtime_generation: 9,
        connection_epoch: 'connection-9',
      }
    );
  });

  it('discards an update from a replaced runtime', async () => {
    const { consumer, workerProfileStatusService } = makeConsumer(false);

    await (consumer as any).processUpdate(event, jest.fn());

    expect(workerProfileStatusService.updateExternalId).not.toHaveBeenCalled();
  });

  it('fails closed when runtime verification is unavailable', async () => {
    const { consumer, workerProfileStatusService } = makeConsumer(
      new Error('redis unavailable')
    );

    await expect(
      (consumer as any).processUpdate(event, jest.fn())
    ).rejects.toThrow('redis unavailable');
    expect(workerProfileStatusService.updateExternalId).not.toHaveBeenCalled();
  });

  it('fails closed before the database mutation when ownership scope is incomplete', async () => {
    const { consumer, workerProfileStatusService } = makeConsumer(true);

    await expect(
      (consumer as any).processUpdate(
        {
          ...event,
          account_id: undefined,
        },
        jest.fn()
      )
    ).rejects.toMatchObject({
      name: 'StaleWhatsappRuntimeDatabaseFenceError',
      reason: 'whatsapp_runtime_database_fence_stale',
    });

    expect(workerProfileStatusService.updateExternalId).not.toHaveBeenCalled();
  });

  it('classifies a stale provider or database generation as terminal', async () => {
    const { consumer, workerProfileStatusService } = makeConsumer(true);
    workerProfileStatusService.updateExternalId.mockRejectedValueOnce(
      new StaleWhatsappRuntimeDatabaseFenceError()
    );

    let error: unknown;
    try {
      await (consumer as any).processUpdate(event, jest.fn());
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);
    expect((consumer as any).classifyConsumerError(error)).toBe('terminal');
  });

  it('does not mutate after Kafka revokes the assignment', async () => {
    const { consumer, workerProfileStatusService } = makeConsumer(true);
    const assertActive = jest
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('assignment revoked');
      });

    await expect(
      (consumer as any).processUpdate(event, assertActive)
    ).rejects.toThrow('assignment revoked');

    expect(workerProfileStatusService.updateExternalId).not.toHaveBeenCalled();
  });
});
