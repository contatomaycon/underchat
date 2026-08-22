import {
  createWorkerCommandTelemetryStore,
  WORKER_COMMAND_DEFERRED_OUTCOMES,
  WORKER_COMMAND_PUBLISH_OUTCOMES,
} from '@core/services/workerCommandTelemetryStore';

describe('WorkerCommandTelemetryStore', () => {
  it('keeps only bounded low-cardinality counters and cumulative latency buckets', () => {
    const store = createWorkerCommandTelemetryStore();

    store.recordPublishRequest(false);
    store.recordPublishRequest(true);
    store.recordPublishOutcome('direct_send', 'accepted');
    store.recordPublishOutcome('direct_send', 'duplicate');
    store.recordPublishTechnicalRetry();
    store.recordPubAckLatency(73.6);
    store.recordDeferred('received');
    store.recordDeferred('relayed');
    store.setRedisGauges({ admissionIdentities: 12, deadlineRecords: 3 });

    const snapshot = store.snapshot();
    expect(Object.keys(snapshot.publish.outcomes).sort()).toEqual(
      [...WORKER_COMMAND_PUBLISH_OUTCOMES].sort()
    );
    expect(Object.keys(snapshot.deferred).sort()).toEqual(
      [...WORKER_COMMAND_DEFERRED_OUTCOMES].sort()
    );
    expect(snapshot.publish.outcomes.accepted).toBe(1);
    expect(snapshot.publish.outcomes.duplicate).toBe(1);
    expect(snapshot.publish.by_command_type.direct_send.accepted).toBe(1);
    expect(snapshot.publish.by_command_type.schedule_send.accepted).toBe(0);
    expect(snapshot.publish.public_retry_requests).toBe(1);
    expect(snapshot.publish.technical_retries).toBe(1);
    expect(snapshot.publish.puback_latency_ms).toMatchObject({
      count: 1,
      sum_ms: 74,
      max_ms: 74,
      buckets: {
        '50': 0,
        '100': 1,
        '5000': 1,
        '+Inf': 1,
      },
    });
    expect(snapshot.deferred.received).toBe(1);
    expect(snapshot.deferred.relayed).toBe(1);
    expect(snapshot.gauges).toMatchObject({
      admission_identities: 12,
      deadline_records: 3,
      sample_errors: 0,
    });
    expect(snapshot.gauges.observed_at).toEqual(expect.any(String));
    expect(snapshot.last_activity_at).toEqual(expect.any(String));

    // No worker/account/chat/operation keys can be introduced dynamically.
    expect(JSON.stringify(snapshot)).not.toContain('worker-123');
  });

  it('tracks gauge failures and resets interval activity without dropping gauges', () => {
    const store = createWorkerCommandTelemetryStore();
    expect(store.flushActivity()).toBeNull();

    store.setRedisGauges({ admissionIdentities: 5, deadlineRecords: 2 });
    store.recordRedisGaugeError();
    store.recordPublishOutcome('notification_send', 'unknown');
    expect(store.flushActivity()).toMatchObject({
      publish: { outcomes: { unknown: 1 } },
      gauges: {
        admission_identities: 5,
        deadline_records: 2,
        sample_errors: 1,
      },
    });

    const afterFlush = store.snapshot();
    expect(afterFlush.publish.outcomes.unknown).toBe(0);
    expect(afterFlush.gauges.admission_identities).toBe(5);
    expect(afterFlush.gauges.deadline_records).toBe(2);
    expect(afterFlush.gauges.sample_errors).toBe(1);
  });
});
