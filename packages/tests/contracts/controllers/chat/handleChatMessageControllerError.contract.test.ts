import 'reflect-metadata';

import { handleChatMessageControllerError } from '@core/controllers/chat/methods/handleChatMessageControllerError';
import { WorkerCommandPublishError } from '@core/services/natsJetStreamPublisher.service';
import { WorkerCommandContractError } from '@core/common/functions/workerCommandEnvelope';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';
import { attachWorkerCommandAcceptancesToError } from '@core/common/functions/workerCommandAcceptanceContext';

function makeReply() {
  const send = jest.fn();
  const reply = {
    request: { id: 'request-1' },
    header: jest.fn(),
    code: jest.fn(() => ({ send })),
  };
  return { reply, send };
}

describe('handleChatMessageControllerError', () => {
  const t = ((key: string) => `translated:${key}`) as never;

  it.each([
    ['translated:chat_not_found', 404],
    ['translated:message_not_found', 404],
    ['translated:chat_access_denied', 403],
    ['translated:only_text_messages_can_be_edited', 400],
    ['translated:whatsapp_official_customer_service_window_closed', 400],
  ])('maps the expected domain failure %s to %i', (message, statusCode) => {
    const { reply, send } = makeReply();

    handleChatMessageControllerError(new Error(message), reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(statusCode);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: false, message })
    );
  });

  it('does not hide unexpected infrastructure failures as a 4xx response', () => {
    const { reply, send } = makeReply();

    handleChatMessageControllerError(
      new Error('elasticsearch_connection_failed'),
      reply as never,
      t
    );

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        message: 'elasticsearch_connection_failed',
      })
    );
  });

  it('returns 503 unknown with the exact retryable operation identity', () => {
    const { reply, send } = makeReply();
    const error = new WorkerCommandPublishError(
      'transport_unavailable',
      'command-1',
      'timeout',
      {
        operationId: 'operation-1',
        issuedAt: '2026-08-13T10:00:00.000Z',
        expiresAt: '2026-08-13T10:05:00.000Z',
        retryUntil: '2026-08-13T10:02:00.000Z',
      }
    );

    handleChatMessageControllerError(error, reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith('X-Operation-Id', 'operation-1');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        data: expect.objectContaining({
          acceptance: 'unknown',
          operation_id: 'operation-1',
          command_id: 'command-1',
        }),
      })
    );
  });

  it('returns 410 before a client intentionally allocates a new operation', () => {
    const { reply, send } = makeReply();
    const error = new WorkerCommandContractError(
      'retry_window_elapsed',
      'elapsed'
    );
    error.operationId = 'operation-1';
    error.commandId = 'command-1';

    handleChatMessageControllerError(error, reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(410);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        data: expect.objectContaining({
          reason: 'retry_window_elapsed',
          operation_id: 'operation-1',
        }),
      })
    );
  });

  it('returns explicit retryable 503 while the operational barrier is paused', () => {
    const { reply, send } = makeReply();
    const error = new WorkerCommandOperationalBarrierError(
      'paused',
      'worker_command_operational_barrier_paused',
      {
        schema_version: 1,
        state: 'paused',
        generation: 8,
        changed_at: '2026-08-13T10:00:00.000Z',
        changed_by: 'change-123',
        reason: 'cutover',
        active_permits: 0,
        oldest_permit_expires_at: null,
      }
    );
    error.operationId = 'operation-blocked';
    attachWorkerCommandAcceptancesToError(error, [
      {
        command_id: 'command-already-accepted',
        operation_id: 'operation-already-accepted',
        stream: 'UC_WORKER_COMMANDS_V1',
        stream_sequence: 9,
        duplicate: false,
        accepted_at: '2026-08-13T09:59:59.000Z',
        expires_at: '2026-08-13T10:04:59.000Z',
      },
    ]);

    handleChatMessageControllerError(error, reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '5');
    expect(reply.header).toHaveBeenCalledWith(
      'X-Operation-Id',
      'operation-blocked'
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        message: 'worker_command_operational_barrier_paused',
        data: expect.objectContaining({
          retryable: true,
          acceptance: 'rejected',
          operation_id: 'operation-blocked',
          barrier_generation: 8,
          accepted_commands: [
            expect.objectContaining({
              operation_id: 'operation-already-accepted',
            }),
          ],
        }),
      })
    );
  });
});
