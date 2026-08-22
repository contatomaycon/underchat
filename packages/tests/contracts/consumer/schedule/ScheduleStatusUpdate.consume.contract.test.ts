import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));

import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import {
  buildScheduleStatusEventId,
  buildScheduleStatusKafkaKey,
} from '@core/common/functions/scheduleStatusIdentity';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { ScheduleStatusUpdateConsume } from '@core/consumer/schedule/ScheduleStatusUpdate.consume';
import {
  ScheduleLegacyProcessingBootstrapClaim,
  ScheduleReconciliationLease,
} from '@core/services/scheduleStatusCoordination.service';

describe('ScheduleStatusUpdateConsume distributed reconciliation', () => {
  const statusUpdate: IScheduleStatusUpdate = {
    schedule_id: 'schedule-1',
    contact_id: 'contact-1',
    message_id: 'message-1',
    status: EScheduleStatus.sent,
  };

  const lease: ScheduleReconciliationLease = {
    scheduleId: 'schedule-1',
    key: '{schedule-status}:reconciliation:v1:lease:schedule-1',
    token: 'lease-owner-1',
    recoveryDeadline: 60_000,
    deadlineVersion: 1,
  };

  const legacyBootstrapLease = {
    key: '{schedule-status}:reconciliation:v1:legacy-processing-bootstrap:v1:lease',
    token: 'bootstrap-owner-1',
  };

  const coordinationMock = () => ({
    scheduleReconciliation: jest.fn(async () => Date.now() + 300_000),
    claimLegacyProcessingBootstrap: jest.fn(
      async (): Promise<ScheduleLegacyProcessingBootstrapClaim> => ({
        state: 'completed',
      })
    ),
    assertLegacyProcessingBootstrapLease: jest.fn(async () => undefined),
    releaseLegacyProcessingBootstrapLease: jest.fn(async () => undefined),
    completeLegacyProcessingBootstrap: jest.fn(async () => true),
    seedLegacyReconciliationDeadline: jest.fn(
      async (_id: string, deadline: number) => ({
        deadline,
        seeded: true,
      })
    ),
    claimDueReconciliations: jest.fn(
      async (): Promise<ScheduleReconciliationLease[]> => []
    ),
    assertReconciliationLease: jest.fn(async () => undefined),
    releaseReconciliationLease: jest.fn(async () => undefined),
    completeReconciliationLease: jest.fn(async () => true),
    currentTimeMilliseconds: jest.fn(async () => 600_000),
    claimMessageAttemptForReconciliation: jest.fn<Promise<any>, any[]>(
      async ({
        scheduleId,
        messageId,
        attemptId,
      }: {
        scheduleId: string;
        messageId: string;
        attemptId?: string;
      }) => ({
        state: 'acquired' as const,
        lease: {
          scheduleId,
          messageId,
          attemptId: attemptId ?? `legacy:${messageId}`,
          key: `{schedule-status}:message-attempt:v2:${scheduleId}:${messageId}`,
          token: 'message-lease-owner-1',
          state: 'reconciling' as const,
        },
      })
    ),
    assertMessageAttemptLease: jest.fn(async () => undefined),
    completeMessageAttemptLease: jest.fn(async () => true),
    releaseMessageAttemptLease: jest.fn(async () => true),
    setMessageOperationalState: jest.fn<Promise<any>, any[]>(
      async () => 'transitioned' as const
    ),
    getMessageOperationalState: jest.fn<Promise<any>, any[]>(
      async () => 'pre_provider_failed' as const
    ),
  });

  const createConsumer = (
    elasticDatabaseService: Record<string, unknown>,
    runtimeFence: Record<string, unknown> = {
      isCurrent: jest.fn(async () => true),
    },
    coordination = coordinationMock()
  ) =>
    new ScheduleStatusUpdateConsume(
      {} as never,
      {
        scheduleStatusUpdate: jest.fn(() => 'schedule.status.update'),
      } as never,
      elasticDatabaseService as never,
      runtimeFence as never,
      coordination as never
    );

  const staleMessage = {
    account_id: 'account-1',
    worker_id: 'worker-1',
    contact_id: 'contact-1',
    message_id: 'message-1',
    attempt_id: 'attempt-1',
  };

  const reconcileOperationalState = async (
    operationalState:
      | 'pending'
      | 'pre_provider_failed'
      | 'provider_rejected'
      | 'ambiguous'
      | 'succeeded'
      | null
  ) => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithScriptOCC: jest.fn(
        async (
          _index: unknown,
          _id: unknown,
          _input: unknown,
          options: { assertActive: () => Promise<void> }
        ) => {
          await options.assertActive();
          return 'updated';
        }
      ),
    };
    const coordination = coordinationMock();
    coordination.getMessageOperationalState.mockResolvedValue(operationalState);
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );
    const assertScheduleLeaseActive = jest.fn(async () => undefined);

    await (consumer as any).reconcileStaleProcessingMessage(
      lease,
      staleMessage,
      600_000,
      assertScheduleLeaseActive
    );

    return {
      assertScheduleLeaseActive,
      coordination,
      elasticDatabaseService,
    };
  };

  it('derives identity from physical schedule operation fields', () => {
    expect(buildScheduleStatusKafkaKey(statusUpdate)).toBe(
      'schedule-1:contact-1:message-1'
    );
    expect(buildScheduleStatusEventId(statusUpdate)).toBe(
      buildScheduleStatusEventId({ ...statusUpdate })
    );
    expect(
      buildScheduleStatusEventId({
        ...statusUpdate,
        status: EScheduleStatus.failed,
      })
    ).not.toBe(buildScheduleStatusEventId(statusUpdate));
    expect(
      buildScheduleStatusEventId({
        ...statusUpdate,
        attempt_id: 'attempt-1',
      } as IScheduleStatusUpdate)
    ).toBe(buildScheduleStatusEventId(statusUpdate));
    expect(
      buildScheduleStatusEventId({
        ...statusUpdate,
        attempt_id: 'attempt-1',
      } as IScheduleStatusUpdate)
    ).toBe(
      buildScheduleStatusEventId({
        ...statusUpdate,
        attempt_id: 'attempt-2',
      } as IScheduleStatusUpdate)
    );
  });

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'rebinds a durable %s schedule outcome to the active generation before immediate reconciliation',
    async (provider) => {
      const elasticDatabaseService = {
        indices: jest.fn(async () => true),
        updateWithScriptOCC: jest.fn(async () => 'updated'),
      };
      const coordination = coordinationMock();
      const lease = {
        assertOwned: jest.fn(),
        release: jest.fn(async () => true),
      };
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({
          state: 'active' as const,
          fence: {
            worker_id: 'worker-1',
            source_provider: provider,
            runtime_generation: 14,
            connection_epoch: `${provider}-epoch-14`,
            connection_sequence: 5,
            activated_at: Date.now(),
            state: 'active' as const,
            activation_order: 5,
          },
        })),
        acquireEffectLease: jest.fn(async () => lease),
        isCurrent: jest.fn(async () => false),
      };
      const consumer = createConsumer(
        elasticDatabaseService,
        runtimeFence,
        coordination
      );
      const rotatedStatus: IScheduleStatusUpdate = {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: provider,
        runtime_generation: 13,
        connection_epoch: `${provider}-epoch-13`,
        attempt_id: 'attempt-1',
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        message_id: 'message-1',
        status: EScheduleStatus.sent,
      };
      rotatedStatus.event_id = buildScheduleStatusEventId(rotatedStatus);
      const stableEventId = rotatedStatus.event_id;

      await expect(
        (consumer as any).acquireRuntimeEffectLease(rotatedStatus)
      ).resolves.toBe(lease);
      await (consumer as any).handleStatusUpdate(
        rotatedStatus,
        { partition: 1, offset: 10, timestamp: 1_000 },
        jest.fn(async () => undefined),
        true
      );

      expect(rotatedStatus).toMatchObject({
        event_id: stableEventId,
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: provider,
        runtime_generation: 14,
        connection_epoch: `${provider}-epoch-14`,
      });
      expect(runtimeFence.isCurrent).not.toHaveBeenCalled();
      expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(
        1
      );
      expect(coordination.scheduleReconciliation).toHaveBeenCalledWith(
        'schedule-1',
        300_000
      );
    }
  );

  it('keeps a forged schedule auxiliary event fail-closed before scope capture', async () => {
    const runtimeFence = {
      viewAdmissionState: jest.fn(),
      acquireEffectLease: jest.fn(),
    };
    const consumer = createConsumer({}, runtimeFence);

    await expect(
      (consumer as any).acquireRuntimeEffectLease({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'baileys',
        runtime_generation: 3,
        connection_epoch: 'epoch-3',
        attempt_id: 'attempt-1',
        event_id: 'forged-schedule-event',
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        message_id: 'message-1',
        status: EScheduleStatus.sent,
      })
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
    });
    expect(runtimeFence.viewAdmissionState).not.toHaveBeenCalled();
  });

  it('persists monotonic rank, passes assignment fencing into OCC and schedules distributed reconciliation', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithScriptOCC: jest
        .fn()
        .mockResolvedValueOnce('updated')
        .mockResolvedValueOnce('noop'),
    };
    const coordination = coordinationMock();
    const runtimeFence = {
      isCurrent: jest.fn(async () => true),
    };
    const consumer = createConsumer(
      elasticDatabaseService,
      runtimeFence,
      coordination
    );
    const assertActive = jest.fn(async () => undefined);

    await (consumer as any).handleStatusUpdate(
      statusUpdate,
      {
        partition: 1,
        offset: 10,
        timestamp: 1_000,
      },
      assertActive
    );
    await (consumer as any).handleStatusUpdate(
      { ...statusUpdate, status: EScheduleStatus.failed },
      {
        partition: 1,
        offset: 11,
        timestamp: 2_000,
      },
      assertActive
    );

    const [index, id, input, options] =
      elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    expect(index).toBe('schedule');
    expect(id).toBe('message-1');
    expect((input as { params: unknown }).params).toEqual(
      expect.objectContaining({
        status: EScheduleStatus.sent,
        status_rank: 3,
        last_event_id: expect.stringMatching(/^schedule_status_v1_/),
      })
    );
    expect(input.source).toContain('if (params.status_rank < currentRank)');
    expect(input.source).toContain('ctx._source.status.equals(params.status)');
    expect(input.source).toContain(
      'if (params.expected_current_status == null)'
    );
    expect(input.source).toContain("ctx._source.remove('operational_state')");
    expect(options.assertActive).toBe(assertActive);
    await expect(options.assertActive()).resolves.toBeUndefined();
    expect(coordination.scheduleReconciliation).toHaveBeenCalledTimes(1);
    expect(coordination.scheduleReconciliation).toHaveBeenCalledWith(
      'schedule-1',
      300_000
    );
    expect((consumer as any).scheduleTrackers).toBeUndefined();
  });

  it('discards a stale provider runtime before Elasticsearch mutation', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(),
      updateWithScriptOCC: jest.fn(),
    };
    const runtimeFence = {
      isCurrent: jest.fn(async () => false),
    };
    const coordination = coordinationMock();
    const consumer = createConsumer(
      elasticDatabaseService,
      runtimeFence,
      coordination
    );
    const staleUpdate: IScheduleStatusUpdate = {
      ...statusUpdate,
      worker_id: 'worker-1',
      source_provider: 'baileys',
      runtime_generation: 6,
      connection_epoch: 'connection-6',
    };

    await (consumer as any).handleStatusUpdate(staleUpdate, {
      partition: 1,
      offset: 10,
      timestamp: 1_000,
    });

    expect(runtimeFence.isCurrent).toHaveBeenCalledWith(staleUpdate);
    expect(elasticDatabaseService.indices).not.toHaveBeenCalled();
    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
    expect(coordination.scheduleReconciliation).not.toHaveBeenCalled();
  });

  it('applies a failed status immediately when the durable outcome is already provider_rejected', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const coordination = coordinationMock();
    coordination.setMessageOperationalState.mockResolvedValue('invalid');
    coordination.getMessageOperationalState.mockResolvedValue(
      'provider_rejected'
    );
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );
    const rejectedStatus: IScheduleStatusUpdate = {
      ...statusUpdate,
      status: EScheduleStatus.failed,
      account_id: 'account-1',
      worker_id: 'worker-1',
      attempt_id: 'attempt-1',
    };

    await (consumer as any).handleStatusUpdate(rejectedStatus, {
      partition: 1,
      offset: 10,
      timestamp: 1_000,
    });

    expect(coordination.getMessageOperationalState).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    });
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(1);
    const updateCalls = elasticDatabaseService.updateWithScriptOCC.mock
      .calls as unknown as unknown[][];
    const input = updateCalls[0]?.[2] as { params: unknown } | undefined;
    expect(input?.params).toEqual(
      expect.objectContaining({
        status: EScheduleStatus.failed,
        attempt_id: 'attempt-1',
      })
    );
    expect(coordination.scheduleReconciliation).toHaveBeenCalledWith(
      'schedule-1',
      300_000
    );
  });

  it('reconciles a proven pre-provider failure without upsert and completes its owned lease', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      select: jest
        .fn()
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _id: 'message-1',
                _source: {
                  id: 'message-1',
                  attempt_id: 'attempt-1',
                  account: { id: 'account-1' },
                  worker: { id: 'worker-1' },
                  contact: { id: 'contact-1' },
                },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: { total: { value: 0 }, hits: [] },
        }),
      updateWithScriptOCC: jest.fn(
        async (
          _index: unknown,
          _id: unknown,
          _input: unknown,
          options: { assertActive: () => Promise<void> }
        ) => {
          await options.assertActive();
          return 'updated';
        }
      ),
    };
    const coordination = coordinationMock();
    coordination.getMessageOperationalState.mockResolvedValue(
      'pre_provider_failed'
    );
    const runtimeFence = {
      isCurrent: jest.fn(async () => true),
    };
    const consumer = createConsumer(
      elasticDatabaseService,
      runtimeFence,
      coordination
    );

    await expect((consumer as any).reconcileSchedule(lease)).resolves.toBe(
      true
    );

    const [, , inputRaw, options] =
      elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    const input = inputRaw as {
      params: Record<string, unknown>;
      upsert?: Record<string, unknown>;
    };
    expect((input as { params: unknown }).params).toEqual(
      expect.objectContaining({
        status: EScheduleStatus.failed,
        expected_current_status: EScheduleStatus.processing,
        attempt_id: 'attempt-1',
        last_event_id: expect.stringMatching(/^schedule_status_v1_/),
      })
    );
    expect(input).not.toHaveProperty('upsert');
    expect(options).toEqual(
      expect.objectContaining({
        upsert: false,
        assertActive: expect.any(Function),
      })
    );
    expect(
      coordination.claimMessageAttemptForReconciliation
    ).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    });
    expect(coordination.getMessageOperationalState).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    });
    expect(coordination.completeMessageAttemptLease).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        messageId: 'message-1',
        attemptId: 'attempt-1',
        state: 'reconciling',
      }),
      'pre_provider_failed'
    );
    expect(coordination.completeReconciliationLease).toHaveBeenCalledWith(
      lease
    );
    expect(runtimeFence.isCurrent).not.toHaveBeenCalled();
    expect(coordination.currentTimeMilliseconds).toHaveBeenCalledTimes(1);
    const staleQuery = elasticDatabaseService.select.mock.calls[0][1];
    expect(
      staleQuery.query.bool.filter[2].bool.should[0].range
        .updated_at_epoch_millis.lte
    ).toBe(300_000);
    const processingCountQuery = elasticDatabaseService.select.mock.calls[1][1];
    expect(processingCountQuery.query.bool.must_not).toContainEqual({
      term: { operational_state: 'ambiguous' },
    });
  });

  it('reconciles a durable provider success as sent even outside the original runtime epoch', async () => {
    const { coordination, elasticDatabaseService } =
      await reconcileOperationalState('succeeded');

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(1);
    const [, , inputRaw, options] =
      elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    const input = inputRaw as {
      params: Record<string, unknown>;
      source: string;
    };
    expect((input as { params: unknown }).params).toEqual(
      expect.objectContaining({
        status: EScheduleStatus.sent,
        expected_current_status: EScheduleStatus.processing,
        attempt_id: 'attempt-1',
      })
    );
    expect(options).toEqual(
      expect.objectContaining({
        upsert: false,
        assertActive: expect.any(Function),
      })
    );
    expect(coordination.completeMessageAttemptLease).toHaveBeenCalledTimes(1);
    expect(coordination.completeMessageAttemptLease).toHaveBeenCalledWith(
      expect.any(Object),
      'succeeded'
    );
    expect(coordination.releaseMessageAttemptLease).not.toHaveBeenCalled();
  });

  it('reconciles a durable provider rejection as failed', async () => {
    const { coordination, elasticDatabaseService } =
      await reconcileOperationalState('provider_rejected');

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(1);
    const [, , inputRaw] =
      elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    expect((inputRaw as { params: unknown }).params).toEqual(
      expect.objectContaining({
        status: EScheduleStatus.failed,
        expected_current_status: EScheduleStatus.processing,
        attempt_id: 'attempt-1',
      })
    );
    expect(coordination.completeMessageAttemptLease).toHaveBeenCalledWith(
      expect.any(Object),
      'provider_rejected'
    );
  });

  it('completes an ambiguous provider attempt without publishing failed or making it retryable', async () => {
    const { coordination, elasticDatabaseService } =
      await reconcileOperationalState('ambiguous');

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(1);
    const [, , inputRaw, options] =
      elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    const input = inputRaw as {
      params: Record<string, unknown>;
      source: string;
    };
    expect(input.params).toEqual({
      expected_status: EScheduleStatus.processing,
      attempt_id: 'attempt-1',
      operational_state: 'ambiguous',
    });
    expect(input.source).not.toContain("ctx._source.status = 'failed'");
    expect(options).toEqual(
      expect.objectContaining({
        upsert: false,
        assertActive: expect.any(Function),
      })
    );
    expect(coordination.completeMessageAttemptLease).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        messageId: 'message-1',
        attemptId: 'attempt-1',
        state: 'reconciling',
      }),
      'ambiguous'
    );
    expect(coordination.releaseMessageAttemptLease).not.toHaveBeenCalled();
  });

  it.each(['pending', null] as const)(
    'leaves a %s operational outcome untouched instead of fabricating a failure',
    async (operationalState) => {
      const { coordination, elasticDatabaseService } =
        await reconcileOperationalState(operationalState);

      expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
      expect(coordination.completeMessageAttemptLease).not.toHaveBeenCalled();
      expect(coordination.releaseMessageAttemptLease).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: 'schedule-1',
          messageId: 'message-1',
          attemptId: 'attempt-1',
          state: 'reconciling',
        })
      );
    }
  );

  it('does not fail an in-flight contact and leaves a new distributed deadline', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      select: jest
        .fn()
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _id: 'message-1',
                _source: {
                  id: 'message-1',
                  attempt_id: 'attempt-1',
                  account: { id: 'account-1' },
                  worker: { id: 'worker-1' },
                  contact: { id: 'contact-1' },
                },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: { total: { value: 1 }, hits: [] },
        }),
      updateWithScriptOCC: jest.fn(),
    };
    const coordination = coordinationMock();
    coordination.claimMessageAttemptForReconciliation.mockResolvedValue({
      state: 'busy',
    });
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );

    await expect((consumer as any).reconcileSchedule(lease)).resolves.toBe(
      false
    );

    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
    expect(coordination.scheduleReconciliation).toHaveBeenCalledWith(
      'schedule-1',
      300_000
    );
    expect(coordination.completeReconciliationLease).not.toHaveBeenCalled();
  });

  it('bootstraps legacy processing schedules from Elasticsearch when Redis has no deadlines', async () => {
    const oldestUpdatedAt = 1_000_000;
    const oldestCreatedAt = 1_200_000;
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      select: jest
        .fn()
        .mockResolvedValueOnce({
          aggregations: {
            processing_schedules: {
              buckets: [
                {
                  key: { schedule_id: 'schedule-legacy-updated' },
                  oldest_updated_at: { value: oldestUpdatedAt },
                  without_updated_at: {
                    oldest_created_at: { value: null },
                    without_timestamp: { doc_count: 0 },
                  },
                },
              ],
              after_key: {
                schedule_id: 'schedule-legacy-updated',
              },
            },
          },
        })
        .mockResolvedValueOnce({
          aggregations: {
            processing_schedules: {
              buckets: [
                {
                  key: { schedule_id: 'schedule-legacy-created' },
                  oldest_updated_at: { value: null },
                  without_updated_at: {
                    oldest_created_at: { value: oldestCreatedAt },
                    without_timestamp: { doc_count: 0 },
                  },
                },
                {
                  key: { schedule_id: 'schedule-legacy-without-timestamp' },
                  oldest_updated_at: { value: null },
                  without_updated_at: {
                    oldest_created_at: { value: null },
                    without_timestamp: { doc_count: 1 },
                  },
                },
              ],
            },
          },
        }),
      updateWithScriptOCC: jest.fn(),
    };
    const coordination = coordinationMock();
    coordination.claimLegacyProcessingBootstrap.mockResolvedValue({
      state: 'acquired',
      lease: legacyBootstrapLease,
    });
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );

    await (consumer as any).processDueReconciliations();

    expect(elasticDatabaseService.select).toHaveBeenCalledTimes(2);
    const firstQuery = elasticDatabaseService.select.mock.calls[0][1];
    const secondQuery = elasticDatabaseService.select.mock.calls[1][1];
    expect(firstQuery).toEqual(
      expect.objectContaining({
        size: 0,
        query: {
          term: {
            status: EScheduleStatus.processing,
          },
        },
      })
    );
    expect(firstQuery.aggs.processing_schedules.composite.sources).toEqual([
      {
        schedule_id: {
          terms: {
            field: 'schedule_id',
          },
        },
      },
    ]);
    expect(secondQuery.aggs.processing_schedules.composite.after).toEqual({
      schedule_id: 'schedule-legacy-updated',
    });
    expect(coordination.seedLegacyReconciliationDeadline.mock.calls).toEqual(
      expect.arrayContaining([
        ['schedule-legacy-updated', oldestUpdatedAt + 300_000],
        ['schedule-legacy-created', oldestCreatedAt + 300_000],
        ['schedule-legacy-without-timestamp', 300_000],
      ])
    );
    expect(coordination.completeLegacyProcessingBootstrap).toHaveBeenCalledWith(
      legacyBootstrapLease,
      3
    );
    expect(coordination.claimDueReconciliations).toHaveBeenCalledWith(25);
  });

  it('runs the legacy processing scan again after the distributed TTL allows a new claim', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      select: jest.fn(async () => ({
        aggregations: {
          processing_schedules: {
            buckets: [],
          },
        },
      })),
      updateWithScriptOCC: jest.fn(),
    };
    const coordination = coordinationMock();
    coordination.claimLegacyProcessingBootstrap.mockResolvedValue({
      state: 'acquired',
      lease: legacyBootstrapLease,
    });
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );

    await (consumer as any).processDueReconciliations();
    await (consumer as any).processDueReconciliations();

    expect(coordination.claimLegacyProcessingBootstrap).toHaveBeenCalledTimes(
      2
    );
    expect(elasticDatabaseService.select).toHaveBeenCalledTimes(2);
    expect(
      coordination.completeLegacyProcessingBootstrap
    ).toHaveBeenCalledTimes(2);
  });

  it('uses Redis time when a status event has no trustworthy timestamp', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithScriptOCC: jest.fn<Promise<string>, any[]>(
        async () => 'updated'
      ),
    };
    const coordination = coordinationMock();
    coordination.currentTimeMilliseconds.mockResolvedValue(765_432);
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );

    await (consumer as any).handleStatusUpdate(statusUpdate, {
      partition: 1,
      offset: 10,
    });

    const updateCall = elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    if (!updateCall) {
      throw new Error('Expected a scripted schedule update');
    }
    const [, , input] = updateCall;
    expect(input.params.event_time_epoch_millis).toBe(765_432);
    expect(input.params.event_time_iso).toBe(new Date(765_432).toISOString());
    expect(coordination.currentTimeMilliseconds).toHaveBeenCalledTimes(1);
  });

  it('paginates every stale processing message with search_after', async () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      select: jest
        .fn()
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _id: 'message-1',
                _source: {
                  id: 'message-1',
                  attempt_id: 'attempt-1',
                  account: { id: 'account-1' },
                  worker: { id: 'worker-1' },
                  contact: { id: 'contact-1' },
                },
                sort: ['message-1'],
              },
              {
                _id: 'message-2',
                _source: {
                  id: 'message-2',
                  attempt_id: 'attempt-2',
                  account: { id: 'account-1' },
                  worker: { id: 'worker-1' },
                  contact: { id: 'contact-2' },
                },
                sort: ['message-2'],
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _id: 'message-3',
                _source: {
                  id: 'message-3',
                  attempt_id: 'attempt-3',
                  account: { id: 'account-1' },
                  worker: { id: 'worker-1' },
                  contact: { id: 'contact-3' },
                },
                sort: ['message-3'],
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: { total: { value: 0 }, hits: [] },
        }),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const coordination = coordinationMock();
    const consumer = createConsumer(
      elasticDatabaseService,
      undefined,
      coordination
    );
    (consumer as any).staleProcessingPageSize = 2;

    await expect((consumer as any).reconcileSchedule(lease)).resolves.toBe(
      true
    );

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(3);
    expect(
      coordination.claimMessageAttemptForReconciliation
    ).toHaveBeenCalledTimes(3);
    expect(coordination.completeMessageAttemptLease).toHaveBeenCalledTimes(3);
    expect(elasticDatabaseService.select.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        size: 2,
        search_after: ['message-2'],
      })
    );
    expect(elasticDatabaseService.select.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        size: 0,
        track_total_hits: true,
      })
    );
  });

  it('aborts and waits for an active reconciliation poll before closing Kafka', async () => {
    const consumer = createConsumer({
      indices: jest.fn(),
      select: jest.fn(),
      updateWithScriptOCC: jest.fn(),
    });
    const abortController = new AbortController();
    let finishPoll: (() => void) | undefined;
    const activePoll = new Promise<void>((resolve) => {
      finishPoll = resolve;
    });
    const runner = {
      close: jest.fn(async () => undefined),
    };
    (consumer as any).reconciliationAbortController = abortController;
    (consumer as any).reconciliationPollPromise = activePoll;
    (consumer as any).reconciliationTimer = setInterval(
      () => undefined,
      60_000
    );
    (consumer as any).runner = runner;

    const closing = consumer.close();
    await Promise.resolve();

    expect(abortController.signal.aborted).toBe(true);
    expect(runner.close).not.toHaveBeenCalled();

    finishPoll?.();
    await closing;

    expect(runner.close).toHaveBeenCalledTimes(1);
    expect((consumer as any).reconciliationPollPromise).toBeNull();
  });

  it('allows only the pod that claimed the lease to reconcile a due schedule', async () => {
    const sharedCoordination = coordinationMock();
    sharedCoordination.claimDueReconciliations
      .mockResolvedValueOnce([lease])
      .mockResolvedValueOnce([]);
    const elasticDatabaseService = {
      indices: jest.fn(),
      select: jest.fn(),
      updateWithScriptOCC: jest.fn(),
    };
    const firstPod = createConsumer(
      elasticDatabaseService,
      undefined,
      sharedCoordination
    );
    const secondPod = createConsumer(
      elasticDatabaseService,
      undefined,
      sharedCoordination
    );
    const firstReconcile = jest
      .spyOn(firstPod as any, 'reconcileSchedule')
      .mockResolvedValue(true);
    const secondReconcile = jest
      .spyOn(secondPod as any, 'reconcileSchedule')
      .mockResolvedValue(true);

    await Promise.all([
      (firstPod as any).processDueReconciliations(),
      (secondPod as any).processDueReconciliations(),
    ]);

    expect(firstReconcile).toHaveBeenCalledWith(lease, expect.any(AbortSignal));
    expect(secondReconcile).not.toHaveBeenCalled();
  });
});
