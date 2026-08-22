import 'reflect-metadata';

import {
  ScheduleMessageInFlightLeaseUnavailableError,
  ScheduleStatusCoordinationService,
} from '@core/services/scheduleStatusCoordination.service';

describe('ScheduleStatusCoordinationService', () => {
  const redisMock = () => ({
    eval: jest.fn<Promise<unknown>, any[]>(async () => 1),
    time: jest.fn<Promise<[string, string]>, any[]>(async () => [
      '100',
      '500000',
    ]),
    zrangebyscore: jest.fn<Promise<string[]>, any[]>(async () => []),
    set: jest.fn<Promise<string | null>, any[]>(async () => 'OK'),
    del: jest.fn<Promise<number>, any[]>(async () => 1),
    exists: jest.fn<Promise<number>, any[]>(async () => 0),
  });

  it('uses Redis time and a cluster-safe hash tag for reconciliation deadlines', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue([100_300_500, 1]);
    const service = new ScheduleStatusCoordinationService(redis as never);

    await expect(
      service.scheduleReconciliation('schedule-1', 300_000)
    ).resolves.toBe(100_300_500);

    const [script, keyCount, deadlineKey, versionKey, scheduleId, delay] =
      redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('HINCRBY'");
    expect(script).toContain('tonumber(current) > incoming');
    expect(keyCount).toBe(2);
    expect(deadlineKey).toContain('{schedule-status}');
    expect(versionKey).toContain('{schedule-status}');
    expect(scheduleId).toBe('schedule-1');
    expect(delay).toBe('300000');
  });

  it('claims with an owner token while atomically retaining a crash-recovery deadline', async () => {
    const redis = redisMock();
    redis.zrangebyscore.mockResolvedValue(['schedule-1']);
    redis.eval.mockResolvedValue([160_500, 7]);
    const service = new ScheduleStatusCoordinationService(redis as never);

    const leases = await service.claimDueReconciliations(10);

    expect(redis.time).toHaveBeenCalledTimes(1);
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      expect.stringContaining('{schedule-status}'),
      '-inf',
      100_500,
      'LIMIT',
      0,
      10
    );
    expect(leases).toEqual([
      expect.objectContaining({
        scheduleId: 'schedule-1',
        key: expect.stringContaining('{schedule-status}'),
        token: expect.any(String),
        recoveryDeadline: 160_500,
        deadlineVersion: 7,
      }),
    ]);

    const [script, keyCount, deadlineKey, leaseKey, versionKey] =
      redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('ZADD'");
    expect(script).not.toContain("redis.call('ZREM'");
    expect(keyCount).toBe(3);
    expect(deadlineKey).toContain('{schedule-status}');
    expect(leaseKey).toContain('{schedule-status}');
    expect(versionKey).toContain('{schedule-status}');
  });

  it('renews both the reconciliation lease and its crash-recovery score', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue(175_000);
    const service = new ScheduleStatusCoordinationService(redis as never);
    const lease = {
      scheduleId: 'schedule-1',
      key: '{schedule-status}:reconciliation:v2:lease:schedule-1',
      token: 'owner-1',
      recoveryDeadline: 160_500,
      deadlineVersion: 7,
    };

    await expect(service.assertReconciliationLease(lease)).resolves.toBe(
      undefined
    );

    const [script, keyCount, deadlineKey, leaseKey, scheduleId, token] =
      redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(script).toContain("redis.call('ZADD'");
    expect(script).toContain("redis.call('TIME')");
    expect(keyCount).toBe(2);
    expect(deadlineKey).toContain('{schedule-status}');
    expect(leaseKey).toBe(lease.key);
    expect(scheduleId).toBe('schedule-1');
    expect(token).toBe('owner-1');
    expect(lease.recoveryDeadline).toBe(175_000);
  });

  it('completes only its own lease and removes no concurrently newer deadline', async () => {
    const redis = redisMock();
    const service = new ScheduleStatusCoordinationService(redis as never);
    const lease = {
      scheduleId: 'schedule-1',
      key: '{schedule-status}:reconciliation:v2:lease:schedule-1',
      token: 'owner-1',
      recoveryDeadline: 160_500,
      deadlineVersion: 7,
    };

    await expect(service.completeReconciliationLease(lease)).resolves.toBe(
      true
    );

    const [
      script,
      keyCount,
      deadlineKey,
      leaseKey,
      completedKey,
      versionKey,
      scheduleId,
      token,
      deadlineVersion,
    ] = redis.eval.mock.calls[0];
    expect(script).toContain('currentVersion == ARGV[3]');
    expect(script).toContain("redis.call('ZREM'");
    expect(script).toContain("redis.call('HDEL'");
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("'PX', ARGV[4]");
    expect(keyCount).toBe(4);
    expect([deadlineKey, leaseKey, completedKey, versionKey]).toEqual(
      expect.arrayContaining([
        expect.stringContaining('{schedule-status}'),
        expect.stringContaining('{schedule-status}'),
        expect.stringContaining('{schedule-status}'),
        expect.stringContaining('{schedule-status}'),
      ])
    );
    expect(scheduleId).toBe('schedule-1');
    expect(token).toBe('owner-1');
    expect(deadlineVersion).toBe('7');
  });

  it('allows only one pod to bootstrap legacy processing schedules', async () => {
    const redis = redisMock();
    redis.eval
      .mockResolvedValueOnce('acquired')
      .mockResolvedValueOnce('busy')
      .mockResolvedValueOnce('completed');
    const service = new ScheduleStatusCoordinationService(redis as never);

    const firstClaim = await service.claimLegacyProcessingBootstrap();
    const secondClaim = await service.claimLegacyProcessingBootstrap();
    const completedClaim = await service.claimLegacyProcessingBootstrap();

    expect(firstClaim).toEqual({
      state: 'acquired',
      lease: {
        key: expect.stringContaining('{schedule-status}'),
        token: expect.any(String),
      },
    });
    expect(secondClaim).toEqual({ state: 'busy' });
    expect(completedClaim).toEqual({ state: 'completed' });

    const [script, keyCount, leaseKey, completedKey] = redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('EXISTS'");
    expect(script).toContain("redis.call('PTTL'");
    expect(script).toContain('completed_ttl == -1');
    expect(script).toContain("redis.call('DEL', KEYS[2])");
    expect(script).toContain("'NX'");
    expect(keyCount).toBe(2);
    expect(leaseKey).toContain('{schedule-status}');
    expect(completedKey).toContain('{schedule-status}');
  });

  it('expires the legacy scan marker so a later rollout document is discovered', async () => {
    const redis = redisMock();
    const service = new ScheduleStatusCoordinationService(redis as never);
    const lease = {
      key: '{schedule-status}:reconciliation:v2:legacy-processing-bootstrap:v1:lease',
      token: 'bootstrap-owner-1',
    };

    await expect(
      service.completeLegacyProcessingBootstrap(lease, 3)
    ).resolves.toBe(true);

    const [
      script,
      keyCount,
      leaseKey,
      completedKey,
      token,
      seededSchedules,
      scanInterval,
    ] = redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("'PX', ARGV[3]");
    expect(script).toContain('seeded_schedules = tonumber(ARGV[2])');
    expect(keyCount).toBe(2);
    expect(leaseKey).toBe(lease.key);
    expect(completedKey).toContain('{schedule-status}');
    expect(token).toBe(lease.token);
    expect(seededSchedules).toBe('3');
    expect(Number(scanInterval)).toBeGreaterThanOrEqual(10_000);
  });

  it('seeds a missing legacy deadline atomically without replacing an existing deadline', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue([100_500, 1]);
    const service = new ScheduleStatusCoordinationService(redis as never);

    await expect(
      service.seedLegacyReconciliationDeadline('schedule-legacy', 90_000)
    ).resolves.toEqual({
      deadline: 100_500,
      seeded: true,
    });

    const [script, keyCount, deadlineKey, versionKey, scheduleId, deadline] =
      redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('ZSCORE'");
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('ZADD'");
    expect(script.indexOf("redis.call('ZSCORE'")).toBeLessThan(
      script.indexOf("redis.call('ZADD'")
    );
    expect(keyCount).toBe(2);
    expect(deadlineKey).toContain('{schedule-status}');
    expect(versionKey).toContain('{schedule-status}');
    expect(scheduleId).toBe('schedule-legacy');
    expect(deadline).toBe('90000');
  });

  it('queues an operational attempt and its earliest reconciliation deadline atomically', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue('queued');
    const service = new ScheduleStatusCoordinationService(redis as never);

    await expect(
      service.queueMessageAttempt({
        scheduleId: 'schedule-1',
        messageId: 'message-1',
        attemptId: 'attempt-1',
        accountId: 'account-1',
        workerId: 'worker-1',
      })
    ).resolves.toBe('queued');

    const [
      script,
      keyCount,
      attemptKey,
      deadlineKey,
      versionKey,
      scheduleId,
      attemptId,
      ,
      ,
      accountId,
      workerId,
      messageId,
    ] = redis.eval.mock.calls[0];
    expect(script).toContain("'state', 'queued'");
    expect(script).toContain("'attempt_id', ARGV[2]");
    expect(script).toContain("'operational_state', 'pending'");
    expect(script).toContain("'account_id', ARGV[5]");
    expect(script).toContain("'worker_id', ARGV[6]");
    expect(script).toContain("'message_id', ARGV[7]");
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('ZADD'");
    expect(script).toContain('tonumber(current_deadline) > lease_until');
    expect(keyCount).toBe(3);
    expect(attemptKey).toContain(
      '{schedule-status}:message-attempt:v3:schedule-1:message-1'
    );
    expect(deadlineKey).toContain('{schedule-status}');
    expect(versionKey).toContain('{schedule-status}');
    expect(scheduleId).toBe('schedule-1');
    expect(attemptId).toBe('attempt-1');
    expect(accountId).toBe('account-1');
    expect(workerId).toBe('worker-1');
    expect(messageId).toBe('message-1');
  });

  it('lets provider invocation supersede a pre-provider failure for the same fully correlated attempt', async () => {
    const redis = redisMock();
    redis.eval
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce('ambiguous');
    const service = new ScheduleStatusCoordinationService(redis as never);
    const identity = {
      scheduleId: 'schedule-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    };

    await expect(
      service.setMessageOperationalState(identity, 'pre_provider_failed')
    ).resolves.toBe('transitioned');
    await expect(
      service.setMessageOperationalState(identity, 'ambiguous')
    ).resolves.toBe('transitioned');
    await expect(service.getMessageOperationalState(identity)).resolves.toBe(
      'ambiguous'
    );

    const [
      transitionScript,
      transitionKeyCount,
      transitionKey,
      transitionDeadlineKey,
      transitionVersionKey,
      transitionAttemptId,
      transitionAccountId,
      transitionWorkerId,
      transitionMessageId,
      transitionState,
    ] = redis.eval.mock.calls[1];
    expect(transitionScript).toContain("current == 'pending'");
    expect(transitionScript).toContain("current == 'pre_provider_failed'");
    expect(transitionScript).toContain("current == 'ambiguous'");
    expect(transitionScript).toContain("target == 'ambiguous'");
    expect(transitionScript).toContain("target == 'succeeded'");
    expect(transitionScript).toContain('schedule_reconciliation()');
    expect(transitionScript).toContain("redis.call('HINCRBY', KEYS[3]");
    expect(transitionKeyCount).toBe(3);
    expect(transitionKey).toContain(
      '{schedule-status}:message-attempt:v3:schedule-1:message-1'
    );
    expect(transitionDeadlineKey).toContain('{schedule-status}');
    expect(transitionVersionKey).toContain('{schedule-status}');
    expect(transitionAttemptId).toBe('attempt-1');
    expect(transitionAccountId).toBe('account-1');
    expect(transitionWorkerId).toBe('worker-1');
    expect(transitionMessageId).toBe('message-1');
    expect(transitionState).toBe('ambiguous');

    const [
      readScript,
      readKeyCount,
      readKey,
      readAttemptId,
      readAccountId,
      readWorkerId,
      readMessageId,
    ] = redis.eval.mock.calls[2];
    expect(readScript).toContain(
      "return redis.call('HGET', KEYS[1], 'operational_state') or ''"
    );
    expect(readKeyCount).toBe(1);
    expect(readKey).toBe(transitionKey);
    expect(readAttemptId).toBe('attempt-1');
    expect(readAccountId).toBe('account-1');
    expect(readWorkerId).toBe('worker-1');
    expect(readMessageId).toBe('message-1');
  });

  it('uses a stable-identity CAS to terminalize a ledger outcome across attempt ids', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue('transitioned');
    const service = new ScheduleStatusCoordinationService(redis as never);

    await expect(
      service.setMessageOperationalStateFromLedger(
        {
          scheduleId: 'schedule-1',
          accountId: 'account-1',
          workerId: 'worker-1',
          messageId: 'message-1',
          attemptId: 'attempt-replacement',
          ledgerOperationId: 'message-1',
        },
        'ambiguous'
      )
    ).resolves.toBe('transitioned');

    const [
      script,
      keyCount,
      attemptKey,
      deadlineKey,
      versionKey,
      scheduleId,
      incomingAttemptId,
      accountId,
      workerId,
      messageId,
      target,
      ledgerOperationId,
    ] = redis.eval.mock.calls[0];
    expect(keyCount).toBe(3);
    expect(attemptKey).toContain(
      '{schedule-status}:message-attempt:v3:schedule-1:message-1'
    );
    expect(deadlineKey).toContain('{schedule-status}');
    expect(versionKey).toContain('{schedule-status}');
    expect(scheduleId).toBe('schedule-1');
    expect(incomingAttemptId).toBe('attempt-replacement');
    expect(accountId).toBe('account-1');
    expect(workerId).toBe('worker-1');
    expect(messageId).toBe('message-1');
    expect(target).toBe('ambiguous');
    expect(ledgerOperationId).toBe('message-1');
    expect(script).toContain('if ledger_operation_id ~= incoming_message');
    expect(script).toContain(
      "current_attempt ~= '' and current_attempt or incoming_attempt"
    );
    expect(script).not.toContain('current_attempt ~= incoming_attempt');
    expect(script).toContain("'ledger_operation_id', ledger_operation_id");
    expect(script).toContain('schedule_reconciliation()');
  });

  it('revokes a divergent live attempt only after a reserved ledger owner was acquired', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue('transitioned');
    const service = new ScheduleStatusCoordinationService(redis as never);

    await expect(
      service.adoptMessageAttemptFromLedgerReservation({
        scheduleId: 'schedule-1',
        accountId: 'account-1',
        workerId: 'worker-1',
        messageId: 'message-1',
        attemptId: 'attempt-replacement',
        ledgerOperationId: 'message-1',
        ledgerReservationOwner: 'ledger-owner-replacement',
      })
    ).resolves.toBe('transitioned');

    const [
      script,
      keyCount,
      attemptKey,
      deadlineKey,
      versionKey,
      scheduleId,
      incomingAttemptId,
      accountId,
      workerId,
      messageId,
      ledgerOperationId,
      ledgerReservationOwner,
    ] = redis.eval.mock.calls[0];
    expect(keyCount).toBe(3);
    expect(attemptKey).toContain(
      '{schedule-status}:message-attempt:v3:schedule-1:message-1'
    );
    expect(deadlineKey).toContain('{schedule-status}');
    expect(versionKey).toContain('{schedule-status}');
    expect(scheduleId).toBe('schedule-1');
    expect(incomingAttemptId).toBe('attempt-replacement');
    expect(accountId).toBe('account-1');
    expect(workerId).toBe('worker-1');
    expect(messageId).toBe('message-1');
    expect(ledgerOperationId).toBe('message-1');
    expect(ledgerReservationOwner).toBe('ledger-owner-replacement');
    expect(script).toContain("if current_operational ~= 'pending' then");
    expect(script).toContain("'state', 'grace'");
    expect(script).toContain("'attempt_id', incoming_attempt");
    expect(script).toContain("'owner', ''");
    expect(script).toContain("'lease_until_ms', '0'");
    expect(script).toContain(
      "'ledger_reservation_owner', ledger_reservation_owner"
    );
    expect(script).toContain('schedule_reconciliation()');
  });

  it('persists an explicit provider rejection after an ambiguous invocation boundary', async () => {
    const redis = redisMock();
    redis.eval
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce('provider_rejected');
    const service = new ScheduleStatusCoordinationService(redis as never);
    const identity = {
      scheduleId: 'schedule-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    };

    await expect(
      service.setMessageOperationalState(identity, 'provider_rejected')
    ).resolves.toBe('transitioned');
    await expect(service.getMessageOperationalState(identity)).resolves.toBe(
      'provider_rejected'
    );

    const transitionCall = redis.eval.mock.calls[0];
    expect(String(transitionCall[0])).toContain("current == 'ambiguous'");
    expect(String(transitionCall[0])).toContain(
      "target == 'provider_rejected'"
    );
    expect(transitionCall[9]).toBe('provider_rejected');
  });

  it('does not expose an operational state from a stale or incomplete correlation', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue('');
    const service = new ScheduleStatusCoordinationService(redis as never);

    await expect(
      service.getMessageOperationalState({
        scheduleId: 'schedule-1',
        accountId: 'account-1',
        workerId: 'worker-1',
        messageId: 'message-1',
        attemptId: 'attempt-replaced',
      })
    ).resolves.toBeNull();
  });

  it('rejects a second pod when the same schedule message is already in flight', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValue('busy');
    const service = new ScheduleStatusCoordinationService(redis as never);
    const callback = jest.fn();

    await expect(
      service.withMessageInFlight(
        {
          scheduleId: 'schedule-1',
          messageId: 'message-1',
          attemptId: 'attempt-1',
        },
        callback
      )
    ).rejects.toBeInstanceOf(ScheduleMessageInFlightLeaseUnavailableError);
    expect(callback).not.toHaveBeenCalled();
  });

  it('checks attempt ownership around the callback and releases it into grace', async () => {
    const redis = redisMock();
    redis.eval.mockImplementation(async (...args: any[]) => {
      const script = String(args[0]);
      if (script.includes("'state', 'in_flight'")) {
        return 'acquired';
      }
      if (
        script.includes("'lease_until_ms', tostring(lease_until)") &&
        script.includes("redis.call('HGET', KEYS[1], 'owner')")
      ) {
        return 100_300_500;
      }
      if (script.includes("'state', 'grace'")) {
        return 1;
      }
      if (script.includes('return { tostring(incoming)')) {
        return [100_300_500, 1];
      }
      return 1;
    });
    const service = new ScheduleStatusCoordinationService(redis as never);
    const callback = jest.fn(async (assertOwned: () => Promise<void>) => {
      await assertOwned();
      return 'processed';
    });

    await expect(
      service.withMessageInFlight(
        {
          scheduleId: 'schedule-1',
          messageId: 'message-1',
          attemptId: 'attempt-1',
        },
        callback
      )
    ).resolves.toBe('processed');

    const claimCall = redis.eval.mock.calls.find(([script]) =>
      String(script).includes("'state', 'in_flight'")
    );
    expect(claimCall).toEqual(
      expect.arrayContaining([
        expect.any(String),
        1,
        expect.stringContaining(
          '{schedule-status}:message-attempt:v3:schedule-1:message-1'
        ),
        'attempt-1',
      ])
    );
    expect(callback).toHaveBeenCalledTimes(1);
    const ownershipChecks = redis.eval.mock.calls.filter(([script]) =>
      String(script).includes("'lease_until_ms', tostring(lease_until)")
    );
    expect(ownershipChecks.length).toBeGreaterThanOrEqual(3);
    expect(
      redis.eval.mock.calls.some(([script]) =>
        String(script).includes("'state', 'grace'")
      )
    ).toBe(true);
  });

  it('lets the reconciler fail a message only after an exclusive attempt claim', async () => {
    const redis = redisMock();
    redis.eval.mockResolvedValueOnce('acquired').mockResolvedValueOnce(1);
    const service = new ScheduleStatusCoordinationService(redis as never);

    const claim = await service.claimMessageAttemptForReconciliation({
      scheduleId: 'schedule-1',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    });
    expect(claim).toEqual({
      state: 'acquired',
      lease: expect.objectContaining({
        scheduleId: 'schedule-1',
        messageId: 'message-1',
        attemptId: 'attempt-1',
        state: 'reconciling',
        token: expect.any(String),
      }),
    });
    if (claim.state !== 'acquired') {
      throw new Error('expected reconciliation attempt lease');
    }

    await expect(
      service.completeMessageAttemptLease(claim.lease)
    ).resolves.toBe(true);

    const [claimScript, keyCount, attemptKey, attemptId] =
      redis.eval.mock.calls[0];
    expect(claimScript).toContain("'state', 'reconciling'");
    expect(claimScript).toContain("'state') or ''");
    expect(claimScript).toContain("'reconciled_operational_state'");
    expect(keyCount).toBe(1);
    expect(attemptKey).toContain(
      '{schedule-status}:message-attempt:v3:schedule-1:message-1'
    );
    expect(attemptId).toBe('attempt-1');
    expect(String(redis.eval.mock.calls[1][0])).toContain(
      "'state', 'completed'"
    );
    expect(String(redis.eval.mock.calls[1][0])).toContain(
      "'reconciled_operational_state'"
    );
  });
});
