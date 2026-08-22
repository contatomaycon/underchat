import 'reflect-metadata';
import { createHash } from 'node:crypto';
import {
  IMessageSendAcquiredClaim,
  MESSAGE_SEND_LEDGER_V4_POLICY,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';
import { runWithWorkerCommandExecutionOutcome } from '@core/common/functions/workerCommandExecutionOutcome';

describe('MessageSendIdempotencyService v4', () => {
  it('surfaces a recovered ambiguous outcome to the JetStream ingress', async () => {
    const service = new MessageSendIdempotencyService({
      eval: jest.fn().mockResolvedValue(['duplicate', 'ambiguous', '{}', '1']),
    } as never);
    const execution = await runWithWorkerCommandExecutionOutcome(() =>
      service.claimOperation({
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'operation-ambiguous-1',
        meta: { provider: 'baileys', worker_id: 'worker-1' },
      })
    );
    expect(execution.value).toMatchObject({
      status: 'duplicate',
      state: 'ambiguous',
      compacted: true,
    });
    expect(execution.outcome).toBe('ambiguous');
  });

  it('derives a provider-neutral key from operation type and operation id', () => {
    const service = new MessageSendIdempotencyService({} as never);
    const digest = createHash('sha256')
      .update('direct\0operation-1')
      .digest('hex');

    expect(
      service.buildOperationKey(' account-1 ', 'direct', ' operation-1 ')
    ).toBe(`message-send:idempotency:v4:account-1:${digest}`);
    expect(service.buildOperationKey('', 'direct', 'operation-1')).toBeNull();
    expect(service.buildOperationKey('account-1', 'direct', ' ')).toBeNull();
  });

  it('keeps central email delivery separate from the worker WhatsApp operation', () => {
    const service = new MessageSendIdempotencyService({} as never);

    const whatsappKey = service.buildOperationKey(
      'account-1',
      'notification',
      'operation-1'
    );
    const emailKey = service.buildOperationKey(
      'account-1',
      'notification_email',
      'operation-1'
    );

    expect(whatsappKey).not.toBeNull();
    expect(emailKey).not.toBeNull();
    expect(emailKey).not.toBe(whatsappKey);
  });

  it('accepts identical content when each user action has a distinct id', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['acquired', 'reserved', '']);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    const claims = await Promise.all(
      ['message-1', 'message-2', 'message-3'].map((operationId) =>
        service.claimOperation({
          accountId: 'account-1',
          operationType: 'direct',
          operationId,
          meta: { text: 'conteudo repetido intencionalmente' },
        })
      )
    );

    expect(claims.map((claim) => claim.status)).toEqual([
      'acquired',
      'acquired',
      'acquired',
    ]);
    const keys = evalMock.mock.calls.map((call) => call[2]);
    expect(new Set(keys).size).toBe(3);
  });

  it('hardcodes state-specific absolute TTLs and a short reservation lease', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['acquired', 'reserved', '']);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    const claim = await service.claimOperation({
      accountId: 'account-1',
      operationType: 'schedule',
      operationId: 'schedule-action-1',
    });

    expect(claim.status).toBe('acquired');
    const call = evalMock.mock.calls[0];
    expect(String(call[0])).toContain("redis.call('TIME')");
    expect(call[1]).toBe(4);
    expect(call[5]).toBe('message-send:provider-watchdog:v4');
    expect(call[7]).toBe(
      String(MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS)
    );
    expect(call[8]).toBe('schedule');
    expect(call[9]).toBe('schedule-action-1');
    expect(MESSAGE_SEND_LEDGER_V4_POLICY.reservedTtlSeconds).toBe(30 * 60);
    expect(MESSAGE_SEND_LEDGER_V4_POLICY.providerInvokedTtlSeconds).toBe(
      60 * 60
    );
    expect(MESSAGE_SEND_LEDGER_V4_POLICY.succeededTtlSeconds).toBe(
      12 * 60 * 60
    );
    expect(MESSAGE_SEND_LEDGER_V4_POLICY.ambiguousTtlSeconds).toBe(
      24 * 60 * 60
    );
    expect(String(call[0])).toContain("redis.call('PEXPIREAT'");
    expect(String(call[0])).toContain('incoming_runtime_is_active');
    expect(String(call[0])).toContain('current_lease <= now_ms');
    expect(String(call[0])).toContain(
      'source_changed and incoming_runtime_is_active()'
    );
    expect(String(call[0])).toContain('connection_sequence');
    expect(String(call[0])).toContain('activation_order');
    expect(String(call[0])).toContain("state == 'provider_invoked'");
    expect(String(call[0])).not.toContain('local runtime_superseded');
    expect(String(call[0])).not.toContain(
      'provider_invocation_runtime_superseded'
    );
    expect(String(call[0])).toContain(
      "'error', 'provider_invocation_lease_expired'"
    );
    expect(String(call[0])).toContain(
      "return {'duplicate', state, stored_recovery_json()}"
    );
    expect(String(call[0])).toContain("redis.call('HGET', key, 'result_json')");
    expect(String(call[0])).toContain(
      "redis.call('HGET', key, 'recovery_json')"
    );
  });

  it('supports a bounded short pre-provider lease for fast crash recovery', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['acquired', 'reserved', '']);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    await service.claimOperation({
      accountId: 'account-1',
      operationType: 'schedule',
      operationId: 'schedule-fast-recovery',
      reservationLeaseMs:
        MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
    });

    expect(evalMock.mock.calls[0][7]).toBe(
      String(MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS)
    );
  });

  it('passes the exact runtime-fence key needed for a fenced reserved takeover', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['acquired', 'reserved', '']);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    await service.claimOperation({
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-1',
      runtimeFenceKey: 'whatsapp:runtime-fence:v1:worker-1',
      meta: {
        provider: 'baileys',
        account_id: 'account-1',
        chat_id: 'chat-1',
        message_id: 'message-1',
        worker_id: 'worker-1',
        runtime_generation: 9,
        connection_epoch: 'epoch-9',
        consumer_assignment_epoch: 17,
      },
    });

    expect(evalMock.mock.calls[0][1]).toBe(4);
    expect(evalMock.mock.calls[0][3]).toBe(
      'whatsapp:runtime-fence:v1:worker-1'
    );
    expect(String(evalMock.mock.calls[0][0])).toContain(
      "tostring(current_fence.state or '') == 'active'"
    );
  });

  it('returns stored update data for a succeeded duplicate', async () => {
    const update = { data: { message_id: 'message-1' } };
    const service = new MessageSendIdempotencyService({
      eval: jest.fn(async () => [
        'duplicate',
        'succeeded',
        JSON.stringify({ update_message: update }),
      ]),
    } as never);

    await expect(
      service.claimOperation({
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'message-1',
      })
    ).resolves.toMatchObject({
      status: 'duplicate',
      state: 'succeeded',
      result: { update_message: update },
    });
  });

  it('fails closed as ambiguous when an existing Redis hash has no state', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['duplicate', 'ambiguous', '']);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    await expect(
      service.claimOperation({
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'corrupt-operation-1',
      })
    ).resolves.toMatchObject({
      status: 'duplicate',
      state: 'ambiguous',
      result: null,
    });

    const claimScript = String(evalMock.mock.calls[0][0]);
    expect(claimScript).toContain("redis.call('EXISTS', key)");
    expect(claimScript).toContain("'error', 'invalid idempotency record'");
    expect(claimScript).toContain("return {'duplicate', state");
  });

  it('returns a terminal identity-conflict reason without exposing another message result', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue(['error', 'identity_conflict', '']);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    await expect(
      service.claimOperation({
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'shared-business-hash',
        meta: {
          provider: 'baileys',
          account_id: 'account-1',
          worker_id: 'worker-1',
          chat_id: 'chat-b',
          message_id: 'message-b',
        },
      })
    ).resolves.toMatchObject({
      status: 'error',
      reason: 'identity_conflict',
      result: null,
    });

    const claimScript = String(evalMock.mock.calls[0][0]);
    expect(claimScript).toContain("'account_id'");
    expect(claimScript).toContain("'chat_id'");
    expect(claimScript).toContain("'message_id'");
    expect(claimScript).toContain("'worker_id'");
    expect(claimScript).toContain("return {'error', 'identity_conflict', ''}");
  });

  it('inspects a durable provider outcome without reserving it and tolerates only declared legacy metadata', async () => {
    const recovery = {
      schema_version: 'schedule_send_ambiguous_recovery_v1',
      operation_id: 'message-1',
    };
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue([
        'duplicate',
        'provider_invoked',
        JSON.stringify(recovery),
      ]);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const meta = {
      provider: 'baileys',
      account_id: 'account-1',
      message_id: 'message-1',
    };

    await expect(
      service.inspectOperation({
        accountId: 'account-1',
        operationType: 'schedule',
        operationId: 'message-1',
        meta,
        compatibleLegacyMetaKeys: ['attempt_id'],
      })
    ).resolves.toMatchObject({
      status: 'duplicate',
      state: 'provider_invoked',
      operationId: 'message-1',
      result: recovery,
    });

    const [
      script,
      keyCount,
      key,
      recoveryKey,
      watchdogKey,
      operationType,
      operationId,
      metaJson,
      metaDigest,
      compatibleLegacyMetaKeysJson,
    ] = evalMock.mock.calls[0];
    expect(keyCount).toBe(3);
    expect(key).toBe(
      service.buildOperationKey('account-1', 'schedule', 'message-1')
    );
    expect(String(recoveryKey)).toContain('message-send:recovery-payload:v4:');
    expect(watchdogKey).toBe('message-send:provider-watchdog:v4');
    expect(operationType).toBe('schedule');
    expect(operationId).toBe('message-1');
    expect(JSON.parse(String(metaJson))).toEqual(meta);
    expect(metaDigest).toBe(
      createHash('sha256').update(String(metaJson)).digest('hex')
    );
    expect(JSON.parse(String(compatibleLegacyMetaKeysJson))).toEqual([
      'attempt_id',
    ]);
    expect(String(script)).toContain("return {'not_found', '', ''}");
    expect(String(script)).toContain('pcall(cjson.decode');
    expect(String(script)).toContain('if not ignored[field]');
    expect(String(script)).not.toContain("'state', 'reserved'");
    expect(String(script)).toContain("elseif state == 'provider_invoked'");
    expect(String(script)).toContain('current_lease <= now_ms');
    expect(String(script)).toContain(
      "'error', 'provider_invocation_lease_expired'"
    );
  });

  it('atomically terminalizes a legacy or corrupt provider outcome without an owner', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const operationId = 'notification-legacy-1';
    const key = service.buildOperationKey(
      'account-1',
      'notification',
      operationId
    );
    if (key === null) {
      throw new Error('expected an idempotency key for the legacy claim');
    }
    const claim = {
      status: 'duplicate',
      state: 'ambiguous',
      accountId: 'account-1',
      operationType: 'notification',
      operationId,
      key,
      owner: null,
      result: null,
    } as const;
    const recovery = {
      schema_version: 'notification_send_ambiguous_recovery_v1',
      operation_id: claim.operationId,
    };
    const meta = {
      provider: 'baileys',
      worker_id: 'worker-1',
      notification_id: 'notification-1',
      destination: 'jid:5511999999999@s.whatsapp.net',
    };

    await expect(
      service.recoverLegacyAmbiguous(claim, recovery, meta)
    ).resolves.toBe('transitioned');

    const [
      script,
      keyCount,
      redisKey,
      recoveryKey,
      watchdogKey,
      recoveryRecordKey,
      operationType,
      redisOperationId,
      metaJson,
      metaDigest,
      resultJson,
      outcomeDigest,
      identityDigest,
      compatibleLegacyMetaKeysJson,
      recoveryDigest,
    ] = evalMock.mock.calls[0];
    expect(keyCount).toBe(4);
    expect(redisKey).toBe(claim.key);
    expect(String(recoveryKey)).toContain('message-send:recovery-payload:v4:');
    expect(watchdogKey).toBe('message-send:provider-watchdog:v4');
    expect(String(recoveryRecordKey)).toContain(
      'message-send:recovery-record:v4:'
    );
    expect(operationType).toBe(claim.operationType);
    expect(redisOperationId).toBe(claim.operationId);
    expect(JSON.parse(String(metaJson))).toEqual(meta);
    expect(metaDigest).toBe(
      createHash('sha256').update(String(metaJson)).digest('hex')
    );
    expect(JSON.parse(String(resultJson))).toEqual(recovery);
    expect(String(outcomeDigest)).toHaveLength(64);
    expect(String(identityDigest)).toHaveLength(64);
    expect(JSON.parse(String(compatibleLegacyMetaKeysJson))).toEqual([]);
    expect(recoveryDigest).toBe(
      createHash('sha256').update(String(resultJson)).digest('hex')
    );
    expect(String(script)).toContain(
      "state ~= 'provider_invoked' and state ~= 'ambiguous'"
    );
    expect(String(script)).toContain(
      "stored_operation_type ~= '' and stored_operation_type ~= operation_type"
    );
    expect(String(script)).toContain(
      'stored_meta_digest == expected_meta_digest'
    );
    expect(String(script)).toContain(
      "not metadata_matches and stored_meta_json == ''"
    );
    expect(String(script)).toContain("'state', 'ambiguous'");
    expect(String(script)).toContain("'owner', ''");
    expect(String(script)).toContain("'lease_until_ms', '0'");
    expect(String(script)).toContain(
      "redis.call('SET', recovery_key, result_json, 'EX', 86400)"
    );
    expect(String(script)).toContain("redis.call('TIME')");
  });

  it.each([
    'identity_conflict',
    'invalid_state',
    'not_found',
    'unexpected_reply',
  ] as const)(
    'fails closed when legacy ambiguous recovery CAS returns %s',
    async (reply) => {
      const service = new MessageSendIdempotencyService({
        eval: jest.fn(async () => reply),
      } as never);
      const key = service.buildOperationKey(
        'account-1',
        'schedule',
        'message-1'
      );
      if (key === null) {
        throw new Error('expected an idempotency key for the legacy claim');
      }

      await expect(
        service.recoverLegacyAmbiguous(
          {
            status: 'duplicate',
            state: 'provider_invoked',
            accountId: 'account-1',
            operationType: 'schedule',
            operationId: 'message-1',
            key,
            owner: null,
            result: null,
          },
          { schema_version: 'schedule_send_ambiguous_recovery_v1' },
          {
            provider: 'baileys',
            account_id: 'account-1',
            message_id: 'message-1',
            worker_id: 'worker-1',
          }
        )
      ).resolves.toBe(reply === 'unexpected_reply' ? 'error' : reply);
    }
  );

  it('accepts a corrupt hash with missing operation/meta fields only through the exact derived claim key', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const operationId = 'corrupt-operation-1';
    const key = service.buildOperationKey(
      'account-1',
      'notification',
      operationId
    );
    if (key === null) {
      throw new Error('expected an idempotency key for the corrupt claim');
    }

    await expect(
      service.recoverLegacyAmbiguous(
        {
          status: 'duplicate',
          state: 'ambiguous',
          accountId: 'account-1',
          operationType: 'notification',
          operationId,
          key,
          owner: null,
          result: null,
        },
        {
          schema_version: 'notification_send_ambiguous_recovery_v1',
          operation_id: operationId,
        },
        {
          provider: 'wwebjs',
          worker_id: 'worker-1',
          notification_id: 'notification-corrupt',
          destination: 'jid:5511999999999@c.us',
        }
      )
    ).resolves.toBe('transitioned');

    const script = String(evalMock.mock.calls[0][0]);
    expect(script).toContain("if redis.call('EXISTS', key) == 0");
    expect(script).toContain("stored_operation_type ~= ''");
    expect(script).toContain("stored_operation_id ~= ''");
    expect(script).toContain('stored_meta_digest == expected_meta_digest');
    expect(script).toContain("stored_meta_json == ''");
  });

  it('bounds a frozen claim instead of holding the caller indefinitely', async () => {
    const previousTimeout = process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS;
    process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS = '250';
    const service = new MessageSendIdempotencyService({
      eval: jest.fn(() => new Promise<never>(() => undefined)),
    } as never);
    const startedAt = Date.now();

    try {
      await expect(
        service.claimOperation({
          accountId: 'account-1',
          operationType: 'direct',
          operationId: 'message-frozen',
          meta: {
            provider: 'baileys',
            account_id: 'account-1',
            worker_id: 'worker-1',
            chat_id: 'chat-1',
            message_id: 'message-frozen',
          },
        })
      ).resolves.toMatchObject({
        status: 'error',
        reason: 'redis_unavailable',
      });
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS;
      } else {
        process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS = previousTimeout;
      }
    }

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('bounds a frozen terminal transition and leaves it retryable', async () => {
    const previousTimeout = process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS;
    process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS = '250';
    const service = new MessageSendIdempotencyService({
      eval: jest.fn(() => new Promise<never>(() => undefined)),
    } as never);
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-frozen-transition',
      key: 'message-send:idempotency:v3:frozen',
      owner: 'owner-1',
      result: null,
    };
    const startedAt = Date.now();

    try {
      await expect(
        service.markFailed(claim, new Error('pre-provider failure'))
      ).resolves.toBe('error');
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS;
      } else {
        process.env.CRITICAL_REDIS_OPERATION_TIMEOUT_MS = previousTimeout;
      }
    }

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('keeps the provider invocation lease beyond the SDK timeout and caps it', () => {
    expect(
      MessageSendIdempotencyService.providerInvocationLeaseMs(Number.NaN)
    ).toBe(MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS);
    expect(
      MessageSendIdempotencyService.providerInvocationLeaseMs(30_000)
    ).toBe(MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS);
    expect(
      MessageSendIdempotencyService.providerInvocationLeaseMs(90_000)
    ).toBe(120_000);
    expect(
      MessageSendIdempotencyService.providerInvocationLeaseMs(120_000)
    ).toBe(MessageSendIdempotencyService.MAX_PROVIDER_INVOCATION_LEASE_MS);
    expect(
      MessageSendIdempotencyService.providerInvocationLeaseMs(300_000)
    ).toBe(MessageSendIdempotencyService.MAX_PROVIDER_INVOCATION_LEASE_MS);
  });

  it('uses owner-checked transitions through provider invocation and success', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce(['acquired', 'reserved', ''])
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const claim = (await service.claimOperation({
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-1',
    })) as IMessageSendAcquiredClaim;

    const recovery = {
      schema_version: 'message_send_ambiguous_terminal_v1',
      status_update: { message_id: 'message-1', failed: true, ambiguous: true },
    };
    await expect(service.markProviderInvoked(claim, recovery)).resolves.toBe(
      'transitioned'
    );
    await expect(
      service.markSucceeded(claim, { update_message: { id: 'provider-1' } })
    ).resolves.toBe('transitioned');

    expect(evalMock.mock.calls[1][6]).toBe(claim.owner);
    expect(evalMock.mock.calls[1][7]).toBe('reserved');
    expect(evalMock.mock.calls[1][8]).toBe('provider_invoked');
    expect(evalMock.mock.calls[1][9]).toBe(
      String(MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS)
    );
    expect(JSON.parse(String(evalMock.mock.calls[1][10]))).toEqual(recovery);
    expect(String(evalMock.mock.calls[1][0])).toContain("redis.call('TIME')");
    expect(evalMock.mock.calls[2][6]).toBe(claim.owner);
    expect(evalMock.mock.calls[2][7]).toBe('provider_invoked');
    expect(evalMock.mock.calls[2][8]).toBe('succeeded');
  });

  it('records an explicit provider rejection as failed after invocation', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-1',
      key: 'message-send:idempotency:v4:account-1:message-1',
      owner: 'owner-1',
      result: null,
    };

    const recovery = {
      schema_version: 'official_whatsapp_provider_rejected_recovery_v1',
      failure_kind: 'meta_graph_api_rejection',
      error: { code: 132000, message: 'Meta Graph #132000' },
    };

    await expect(
      service.markProviderRejected(
        claim,
        new Error('Meta Graph #132000'),
        recovery
      )
    ).resolves.toBe('transitioned');

    expect(evalMock.mock.calls[0][6]).toBe(claim.owner);
    expect(evalMock.mock.calls[0][7]).toBe('provider_invoked');
    expect(evalMock.mock.calls[0][8]).toBe('failed');
    expect(evalMock.mock.calls[0][9]).toBe('0');
    expect(JSON.parse(String(evalMock.mock.calls[0][10]))).toEqual(recovery);
    expect(evalMock.mock.calls[0][11]).toContain('Meta Graph #132000');
  });

  it('owner-fences a confirmed pre-SDK reversal back to a live reservation', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-1',
      key: 'message-send:idempotency:v4:account-1:message-1',
      owner: 'owner-1',
      result: null,
    };

    await expect(
      service.revertProviderInvocationBeforeStart(claim, 42_000)
    ).resolves.toBe('transitioned');

    expect(evalMock.mock.calls[0][6]).toBe(claim.owner);
    expect(evalMock.mock.calls[0][7]).toBe('provider_invoked');
    expect(evalMock.mock.calls[0][8]).toBe('reserved');
    expect(evalMock.mock.calls[0][9]).toBe('42000');
    expect(evalMock.mock.calls[0][11]).toBe('provider_start_fence_rejected');
  });

  it('stores a recoverable terminal outcome when failure is proven before provider invocation', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-1',
      key: 'message-send:idempotency:v4:account-1:message-1',
      owner: 'owner-1',
      result: null,
    };
    const recovery = {
      schema_version: 'message_send_terminal_failure_recovery_v1',
      provider: 'baileys',
      status_update: {
        account_id: 'account-1',
        worker_id: 'worker-1',
        message_id: 'message-1',
        internal_message_id: 'message-1',
        patch: {},
        failed: true,
      },
    };

    await expect(
      service.markFailed(claim, new Error('local preflight failed'), recovery)
    ).resolves.toBe('transitioned');

    expect(evalMock.mock.calls[0][7]).toBe('reserved');
    expect(evalMock.mock.calls[0][8]).toBe('failed');
    expect(JSON.parse(String(evalMock.mock.calls[0][10]))).toEqual(recovery);
    expect(evalMock.mock.calls[0][11]).toContain('local preflight failed');
  });

  it('indexes provider invocations atomically and watchdogs them without keyspace scans', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce('transitioned')
      .mockResolvedValueOnce([4, 2, 1]);
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'watchdog-message-1',
      key: 'message-send:idempotency:v4:account-1:watchdog-message-1',
      owner: 'owner-watchdog',
      result: null,
    };

    await expect(
      service.markProviderInvoked(claim, { update: 1 })
    ).resolves.toBe('transitioned');
    const transitionScript = String(evalMock.mock.calls[0][0]);
    expect(evalMock.mock.calls[0].slice(1, 7)).toEqual([
      4,
      claim.key,
      expect.stringContaining('message-send:recovery-payload:v4:'),
      'message-send:provider-watchdog:v4',
      expect.stringContaining('message-send:recovery-record:v4:'),
      claim.owner,
    ]);
    expect(transitionScript).toContain(
      "redis.call('ZADD', watchdog_key, watchdog_due_at_ms, key)"
    );
    expect(transitionScript).toContain("target_state == 'provider_invoked'");
    expect(transitionScript).toContain(
      String(MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxAgeMs)
    );

    await expect(
      service.processProviderInvocationWatchdogBatch()
    ).resolves.toEqual({ examined: 4, terminalized: 2, cleaned: 1 });
    const watchdogScript = String(evalMock.mock.calls[1][0]);
    expect(evalMock.mock.calls[1].slice(1)).toEqual([
      1,
      'message-send:provider-watchdog:v4',
      String(MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogBatchSize),
      'message-send:recovery:v4:',
      'message-send:recovery-workers:v4',
    ]);
    expect(watchdogScript).toContain("'ZRANGEBYSCORE', watchdog_key");
    expect(watchdogScript).toContain(
      "'error', 'provider_invocation_watchdog_expired'"
    );
    expect(watchdogScript).toContain("state == 'provider_invoked'");
    expect(watchdogScript).not.toContain("redis.call('SCAN'");
    expect(watchdogScript).not.toContain("redis.call('KEYS'");
    expect(
      MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxAgeMs
    ).toBe(5 * 60 * 1000);
  });

  it('compacts only the exact terminal state and recovery after broker PubAck', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValue('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const recovery = { update_message: { event_id: 'event-1' } };
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-compact-1',
      key: 'message-send:idempotency:v4:account-1:message-compact-1',
      owner: 'owner-compact',
      result: null,
    };

    await expect(
      service.compactTerminalAfterRecoveryPubAck(claim, 'succeeded', recovery)
    ).resolves.toBe('transitioned');

    const [
      script,
      keyCount,
      key,
      recoveryKey,
      watchdogKey,
      recoveryRecordKey,
      ...args
    ] = evalMock.mock.calls[0];
    expect(keyCount).toBe(4);
    expect(key).toBe(claim.key);
    expect(String(recoveryKey)).toContain('message-send:recovery-payload:v4:');
    expect(watchdogKey).toBe('message-send:provider-watchdog:v4');
    expect(String(recoveryRecordKey)).toContain(
      'message-send:recovery-record:v4:'
    );
    expect(args).toEqual([
      claim.operationType,
      claim.operationId,
      'succeeded',
      JSON.stringify(recovery),
      createHash('sha256').update(JSON.stringify(recovery)).digest('hex'),
      '',
      'message-send:recovery:v4:',
      'message-send:recovery-workers:v4',
    ]);
    expect(String(script)).toContain('state ~= expected_state');
    expect(String(script)).toContain('stored_recovery ~= expected_recovery');
    expect(String(script)).toContain(
      "redis.call('HGET', key, 'compacted_at_ms')"
    );
    expect(String(script)).toContain('== expected_recovery_digest');
    expect(String(script)).toContain("redis.call('HDEL', key");
    expect(String(script)).toContain(
      "redis.call('DEL', recovery_key, recovery_record_key)"
    );
    expect(String(script)).not.toContain("redis.call('DEL', key)");
  });

  it('terminalizes the durable command lane before compacting its recovery', async () => {
    const evalMock = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce('transitioned');
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);
    const claim: IMessageSendAcquiredClaim = {
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-lane-1',
      key: 'message-send:idempotency:v4:account-1:message-lane-1',
      owner: 'owner-lane',
      result: null,
    };

    await runWithWorkerCommandExecutionOutcome(
      () =>
        service.compactTerminalAfterRecoveryPubAck(claim, 'ambiguous', null),
      {
        accountId: 'account-1',
        workerId: 'worker-1',
        entityKey: 'chat:account-1:worker-1:jid-1',
        operationId: 'message-lane-1',
        commandId: 'command-1',
      }
    );

    expect(String(evalMock.mock.calls[0][0])).toContain(
      "'op:' .. operation_digest .. ':terminal'"
    );
    expect(evalMock.mock.calls[0]).toEqual(
      expect.arrayContaining([
        'message-lane-1',
        'ambiguous',
        'command-1',
        'ambiguous',
      ])
    );
    expect(String(evalMock.mock.calls[1][0])).toContain(
      "redis.call('DEL', recovery_key, recovery_record_key)"
    );
  });

  it('fails closed when identity or Redis is unavailable', async () => {
    const evalMock = jest.fn(async () => {
      throw new Error('redis unavailable');
    });
    const service = new MessageSendIdempotencyService({
      eval: evalMock,
    } as never);

    await expect(
      service.claimOperation({
        accountId: '',
        operationType: 'direct',
        operationId: 'message-1',
      })
    ).resolves.toMatchObject({ status: 'error' });
    await expect(
      service.claimOperation({
        accountId: 'account-1',
        operationType: 'direct',
        operationId: 'message-1',
      })
    ).resolves.toMatchObject({ status: 'error' });
  });

  it('keeps compatibility lookup on the v4 direct-operation key', async () => {
    const exists = jest
      .fn<Promise<number>, unknown[]>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const service = new MessageSendIdempotencyService({ exists } as never);

    await expect(service.lookupClaim('account-1', 'message-1')).resolves.toBe(
      'claimed'
    );
    await expect(service.lookupClaim('account-1', 'message-2')).resolves.toBe(
      'not_found'
    );
  });
});
