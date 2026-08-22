import {
  buildMessageSendRecoveryPlan,
  MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS,
  parseMessageSendRecoveryPlan,
} from '@core/common/functions/messageSendRecoveryPlan';

describe('message-send global recovery plan v1', () => {
  it('materializes an allowlisted status projection with a stable identity', () => {
    const recovery = {
      schema_version: 'message_send_ambiguous_terminal_v1',
      provider: 'baileys',
      operation_id: 'message-1',
      outcome_digest: 'digest',
      status_update: {
        event_id: 'status-event-1',
        account_id: 'account-1',
        worker_id: 'worker-1',
        message_id: 'message-1',
        failed: true,
        patch: {},
      },
    };
    const plan = buildMessageSendRecoveryPlan({
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-1',
      expectedState: 'provider_invoked',
      targetState: 'ambiguous',
      recovery,
      meta: { provider: 'baileys', worker_id: 'worker-1' },
      now: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(plan).toMatchObject({
      kind: 'worker_global_publications_v1',
      terminal_state: 'ambiguous',
      worker_id: 'worker-1',
      steps: [
        {
          kind: 'kafka_publication_v1',
          topic: MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.updateMessageStatus,
          key: 'account-1:worker-1:message-1',
          payload: recovery.status_update,
        },
      ],
    });
    expect(parseMessageSendRecoveryPlan(plan)).toEqual(plan);
  });

  it('persists schedule operational state and a deterministic failed projection', () => {
    const plan = buildMessageSendRecoveryPlan({
      accountId: 'account-1',
      operationType: 'schedule',
      operationId: 'message-2',
      expectedState: 'reserved',
      targetState: 'failed',
      recovery: null,
      meta: {
        provider: 'wwebjs',
        worker_id: 'worker-2',
        schedule_id: 'schedule-1',
        contact_id: 'contact-1',
        message_id: 'message-2',
        attempt_id: 'attempt-1',
      },
      now: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(plan?.steps).toEqual([
      expect.objectContaining({
        kind: 'schedule_operational_state_v1',
        state: 'pre_provider_failed',
        ledger_operation_id: 'message-2',
      }),
      expect.objectContaining({
        kind: 'kafka_publication_v1',
        topic: MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.scheduleStatusUpdate,
        key: 'schedule-1:contact-1:message-2',
        payload: expect.objectContaining({
          status: 'failed',
          event_id: expect.stringMatching(/^schedule_status_v1_/u),
        }),
      }),
    ]);
  });

  it('requires handler-owned recovery for official non-broker effects', () => {
    const plan = buildMessageSendRecoveryPlan({
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-3',
      expectedState: 'provider_invoked',
      targetState: 'succeeded',
      recovery: {
        schema_version: 'official_whatsapp_send_recovery_v1',
        update_message: {
          event_id: 'message-event-1',
          worker_id: 'worker-3',
          data: {
            account: { id: 'account-1' },
            worker: { id: 'worker-3' },
            message_id: 'message-3',
          },
          message: { key: { id: 'wamid.1' } },
        },
      },
      meta: {
        provider: 'official-whatsapp',
        worker_id: 'worker-3',
      },
      now: new Date('2026-08-13T00:00:00.000Z'),
    });
    expect(plan?.kind).toBe('official_handler_recovery_v1');
  });

  it('models call auto-reply recovery as one allowlisted global upsert projection', () => {
    const upsert = {
      worker_id: 'worker-call',
      account_id: 'account-call',
      type: 'system',
      message: {
        key: { id: 'call_auto_system_1', fromMe: true },
        message: { conversation: 'Não atendemos chamadas.' },
      },
    };
    const plan = buildMessageSendRecoveryPlan({
      accountId: 'account-call',
      operationType: 'direct',
      operationId: 'call-auto-reply:worker-call:call-1',
      expectedState: 'provider_invoked',
      targetState: 'succeeded',
      recovery: {
        schema_version: 'call_auto_reply_system_upsert_recovery_v1',
        provider: 'baileys',
        account_id: 'account-call',
        worker_id: 'worker-call',
        operation_id: 'call-auto-reply:worker-call:call-1',
        call_auto_reply_system_upsert: upsert,
        kafka_key: 'call_auto_system_1',
        // A command envelope is deliberately ignored by the descriptor.
        payload: { original_command: true },
      },
      meta: { worker_id: 'worker-call' },
    });

    expect(plan?.steps).toEqual([
      expect.objectContaining({
        kind: 'kafka_publication_v1',
        topic: MESSAGE_SEND_GLOBAL_RECOVERY_TOPICS.upsertMessage,
        key: 'call_auto_system_1',
        payload: upsert,
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('original_command');
  });

  it('rejects a tampered publication payload or unallowlisted topic', () => {
    const plan = buildMessageSendRecoveryPlan({
      accountId: 'account-1',
      operationType: 'direct',
      operationId: 'message-4',
      expectedState: 'provider_invoked',
      targetState: 'ambiguous',
      recovery: {
        provider: 'baileys',
        status_update: {
          account_id: 'account-1',
          worker_id: 'worker-4',
          message_id: 'message-4',
        },
      },
      meta: { provider: 'baileys', worker_id: 'worker-4' },
    });
    expect(plan).not.toBeNull();
    if (!plan) throw new Error('Expected a recovery plan');
    const tampered = structuredClone(plan);
    const publication = tampered.steps[0] as {
      topic: string;
      payload: Record<string, unknown>;
    };
    publication.topic = 'worker.worker-4.send';
    publication.payload.injected = true;
    expect(parseMessageSendRecoveryPlan(tampered)).toBeNull();
  });
});
