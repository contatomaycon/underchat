import 'reflect-metadata';

import { handleScheduleControllerError } from '@core/controllers/schedule/methods/handleScheduleControllerError';

const t = ((key: string) => `translated:${key}`) as never;

function makeReply() {
  const send = jest.fn();
  const reply = {
    request: { id: 'request-1' },
    code: jest.fn(() => ({ send })),
  };

  return { reply, send };
}

describe('handleScheduleControllerError', () => {
  it.each([
    ['translated:worker_not_found', 404],
    ['translated:schedule_not_found', 404],
    ['translated:chat_access_denied', 403],
    ['translated:whatsapp_official_connection_access_lost', 409],
  ])('maps %s to HTTP %i', (message, statusCode) => {
    const { reply, send } = makeReply();

    handleScheduleControllerError(new Error(message), reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(statusCode);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: false, message })
    );
  });

  it('keeps unexpected failures as server errors', () => {
    const { reply, send } = makeReply();

    handleScheduleControllerError(
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
});
