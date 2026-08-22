import 'reflect-metadata';

import { container } from 'tsyringe';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { recordWorkerCommandAcceptance } from '@core/common/functions/workerCommandAcceptanceContext';
import type { WorkerCommandPublishReceiptV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';
import { reactMessage } from '@core/controllers/chat/methods/reactMessage';
import { deleteMessage } from '@core/controllers/chat/methods/deleteMessage';
import { editMessage } from '@core/controllers/chat/methods/editMessage';
import { forwardMessage } from '@core/controllers/chat/methods/forwardMessage';
import { createMessageChats } from '@core/controllers/chat/methods/createMessageChats';
import { WorkerCommandPublishError } from '@core/services/natsJetStreamPublisher.service';

const OPERATION_ID = '019a0000-0000-7000-8000-000000000001';
const RETRY_OF = '019a0000-0000-7000-8000-000000000002';
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const receipt = (
  operationId: string,
  sequence = 1
): WorkerCommandPublishReceiptV1 => ({
  command_id: `command-${sequence}`,
  operation_id: operationId,
  stream: 'UC_WORKER_COMMANDS_V1',
  stream_sequence: sequence,
  duplicate: false,
  accepted_at: '2026-08-13T10:00:00.000Z',
  expires_at: '2026-08-13T10:05:00.000Z',
});

function makeReply() {
  const reply = {
    request: { id: 'request-1' },
    header: jest.fn(),
    code: jest.fn(),
    send: jest.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.code.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply;
}

function makeRequest(body: Record<string, unknown>) {
  return {
    id: 'request-1',
    module: ERouteModule.manager,
    params: {
      chat_id: '019a0000-0000-7000-8000-000000000010',
      message_id: 'provider-message-1',
    },
    body,
    t: (key: string) => key,
    tokenJwtData: {
      account_id: 'account-1',
      user_id: 'user-1',
      actions: [],
      sectors: [],
      channels: [],
    },
  };
}

describe('worker command action controllers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    {
      name: 'reaction',
      controller: reactMessage,
      body: {
        emoji: '👍',
        operation_id: OPERATION_ID,
        retry_of: RETRY_OF,
      },
      bodyArgument: 3,
    },
    {
      name: 'delete',
      controller: deleteMessage,
      body: { operation_id: OPERATION_ID, retry_of: RETRY_OF },
      bodyArgument: 3,
    },
    {
      name: 'edit',
      controller: editMessage,
      body: {
        message: 'edited',
        operation_id: OPERATION_ID,
        retry_of: RETRY_OF,
      },
      bodyArgument: 3,
    },
  ] as const)(
    'returns the PubAck receipt for $name',
    async ({ controller, body, bodyArgument }) => {
      const execute = jest.fn<Promise<boolean>, unknown[]>(async () => {
        recordWorkerCommandAcceptance(receipt(OPERATION_ID));
        return true;
      });
      jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
      const reply = makeReply();

      await controller(makeRequest(body) as never, reply as never);

      expect(execute.mock.calls[0]?.[bodyArgument]).toEqual(
        expect.objectContaining({
          operation_id: OPERATION_ID,
          retry_of: RETRY_OF,
        })
      );
      expect(reply.header).toHaveBeenCalledWith('X-Operation-Id', OPERATION_ID);
      expect(reply.header).toHaveBeenCalledWith(
        'X-Command-Acceptance-Count',
        '1'
      );
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: true,
          data: true,
          operation_id: OPERATION_ID,
          command_id: 'command-1',
          accepted_commands: [
            expect.objectContaining({
              operation_id: OPERATION_ID,
              command_id: 'command-1',
            }),
          ],
        })
      );
    }
  );

  it.each([
    {
      name: 'reaction',
      controller: reactMessage,
      body: { emoji: '👍' },
      bodyArgument: 3,
    },
    {
      name: 'delete',
      controller: deleteMessage,
      body: {},
      bodyArgument: 3,
    },
    {
      name: 'edit',
      controller: editMessage,
      body: { message: 'edited' },
      bodyArgument: 3,
    },
    {
      name: 'direct message',
      controller: createMessageChats,
      body: { type: 'text', message: 'hello' },
      bodyArgument: 3,
    },
  ] as const)(
    'generates and returns a stable UUIDv7 receipt identity for $name',
    async ({ controller, body, bodyArgument }) => {
      const execute = jest.fn<Promise<boolean>, unknown[]>(async (...args) => {
        const commandBody = args[bodyArgument] as { operation_id: string };
        recordWorkerCommandAcceptance(receipt(commandBody.operation_id));
        return true;
      });
      jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
      const reply = makeReply();

      await controller(makeRequest(body) as never, reply as never);

      const commandBody = execute.mock.calls[0]?.[bodyArgument] as {
        operation_id: string;
      };
      expect(commandBody.operation_id).toMatch(UUID_V7_PATTERN);
      expect(reply.header).toHaveBeenCalledWith(
        'X-Operation-Id',
        commandBody.operation_id
      );
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_id: commandBody.operation_id,
          accepted_commands: [
            expect.objectContaining({
              operation_id: commandBody.operation_id,
            }),
          ],
        })
      );
    }
  );

  it('generates and returns a UUIDv7 base identity for forward', async () => {
    const execute = jest.fn(async (...args: unknown[]) => {
      const commandBody = args[3] as { idempotency_key: string };
      recordWorkerCommandAcceptance(receipt(commandBody.idempotency_key));
      return { requested: 1, sent: 1, failed: 0, results: [] };
    });
    jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
    const reply = makeReply();

    await forwardMessage(
      makeRequest({
        target_chat_ids: ['019a0000-0000-7000-8000-000000000011'],
      }) as never,
      reply as never
    );

    const commandBody = execute.mock.calls[0]?.[3] as {
      idempotency_key: string;
    };
    expect(commandBody.idempotency_key).toMatch(UUID_V7_PATTERN);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: commandBody.idempotency_key,
        commands: [
          expect.objectContaining({
            operation_id: commandBody.idempotency_key,
          }),
        ],
      })
    );
  });

  it('returns every accepted fan-out receipt and its stable base identity', async () => {
    const secondOperation =
      '22073a3a83399a7812553d81c50c991085c2b5f0b063989441c4920e4642523f';
    const execute = jest.fn(async () => {
      recordWorkerCommandAcceptance(receipt('operation-target-1', 1));
      recordWorkerCommandAcceptance(receipt(secondOperation, 2));
      return { requested: 2, sent: 2, failed: 0, results: [] };
    });
    jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
    const reply = makeReply();
    const request = makeRequest({
      idempotency_key: OPERATION_ID,
      target_chat_ids: [
        '019a0000-0000-7000-8000-000000000011',
        '019a0000-0000-7000-8000-000000000012',
      ],
    });

    await forwardMessage(request as never, reply as never);

    expect(reply.header).toHaveBeenCalledWith(
      'X-Command-Acceptance-Count',
      '2'
    );
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: true,
        idempotency_key: OPERATION_ID,
        commands: [
          expect.objectContaining({ command_id: 'command-1' }),
          expect.objectContaining({ command_id: 'command-2' }),
        ],
      })
    );
  });

  it('preserves the accepted-count header when a later fan-out PubAck is unknown', async () => {
    const execute = jest.fn(async () => {
      recordWorkerCommandAcceptance(receipt('operation-target-1', 1));
      throw new WorkerCommandPublishError(
        'transport_unavailable',
        'command-2',
        'timeout',
        { operationId: 'operation-target-2' }
      );
    });
    jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
    const reply = makeReply();
    const request = makeRequest({
      idempotency_key: OPERATION_ID,
      target_chat_ids: [
        '019a0000-0000-7000-8000-000000000011',
        '019a0000-0000-7000-8000-000000000012',
      ],
    });

    await forwardMessage(request as never, reply as never);

    expect(reply.header).toHaveBeenCalledWith(
      'X-Command-Acceptance-Count',
      '1'
    );
    expect(reply.header).toHaveBeenCalledWith(
      'X-Operation-Id',
      'operation-target-2'
    );
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        data: expect.objectContaining({
          acceptance: 'unknown',
          accepted_commands: [
            expect.objectContaining({
              operation_id: 'operation-target-1',
              command_id: 'command-1',
            }),
          ],
        }),
      })
    );
  });

  it('keeps a direct-message PubAck successful when a later projection fails', async () => {
    const projectionError = new Error('centrifugo_projection_failed');
    const execute = jest.fn(async () => {
      recordWorkerCommandAcceptance(receipt(OPERATION_ID));
      throw projectionError;
    });
    jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
    const reply = makeReply();
    const request = makeRequest({
      operation_id: OPERATION_ID,
      type: 'text',
      message: 'hello',
    });

    await createMessageChats(request as never, reply as never);

    expect(reply.header).toHaveBeenCalledWith('X-Operation-Id', OPERATION_ID);
    expect(reply.header).toHaveBeenCalledWith(
      'X-Command-Acceptance-Count',
      '1'
    );
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: true,
        data: true,
        operation_id: OPERATION_ID,
        command_id: 'command-1',
        accepted_commands: [
          expect.objectContaining({
            operation_id: OPERATION_ID,
            command_id: 'command-1',
          }),
        ],
      })
    );
  });
});
