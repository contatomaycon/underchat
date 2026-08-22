import 'reflect-metadata';

import { handleChatMutationControllerError } from '@core/controllers/chat/methods/handleChatMutationControllerError';

function makeReply() {
  const send = jest.fn();
  const reply = {
    request: { id: 'request-1', log: { error: jest.fn() } },
    code: jest.fn(() => ({ send })),
  };
  return { reply, send };
}

const t = ((key: string, values?: Record<string, string>) => {
  if (key === 'chat_already_in_service_with_sector') {
    return `already active in ${values?.sector ?? '{{sector}}'}`;
  }
  if (key === 'simultaneous_attendance_limit_reached') {
    return `attendance limit ${values?.limit ?? '{{limit}}'} reached`;
  }
  return `translated:${key}`;
}) as never;

describe('handleChatMutationControllerError', () => {
  it.each([
    ['translated:chat_not_found', 'translated:chat_not_found', 404],
    [
      'translated:chat_create_not_found',
      'translated:chat_create_not_found',
      404,
    ],
    ['label_template_not_found', 'translated:label_template_not_found', 404],
    ['translated:chat_access_denied', 'translated:chat_access_denied', 403],
    [
      'translated:chat_join_only_in_chat',
      'translated:chat_join_only_in_chat',
      400,
    ],
    [
      'translated:contact_already_validated',
      'translated:contact_already_validated',
      400,
    ],
    [
      'contact_channel_not_available',
      'translated:contact_channel_not_available',
      400,
    ],
    [
      'translated:contact_phone_required',
      'translated:contact_phone_required',
      400,
    ],
    [
      'translated:whatsapp_official_waiting_contact_reply',
      'translated:whatsapp_official_waiting_contact_reply',
      400,
    ],
    [
      'translated:official_opening_only_official_channel',
      'translated:official_opening_only_official_channel',
      400,
    ],
    [
      'translated:no_active_worker_for_validation',
      'translated:no_active_worker_for_validation',
      503,
    ],
    ['already active in Atendimento', 'already active in Atendimento', 400],
    ['attendance limit 5 reached', 'attendance limit 5 reached', 400],
  ])(
    'maps the expected domain failure %s to an explicit status',
    (message, responseMessage, statusCode) => {
      const { reply, send } = makeReply();

      handleChatMutationControllerError(new Error(message), reply as never, t);

      expect(reply.code).toHaveBeenCalledWith(statusCode);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ status: false, message: responseMessage })
      );
    }
  );

  it('does not downgrade an unexpected infrastructure failure to a 4xx', () => {
    const { reply, send } = makeReply();

    handleChatMutationControllerError(
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

  it('returns a refreshable conflict reason when the official window closed', () => {
    const { reply, send } = makeReply();

    handleChatMutationControllerError(
      new Error('translated:official_window_requires_template_refresh'),
      reply as never,
      t,
      { sanitizeUnexpected: true }
    );

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'request-1',
        message: 'translated:official_window_requires_template_refresh',
        data: { reason: 'official_window_requires_template_refresh' },
      })
    );
  });

  it('hides unexpected infrastructure details while preserving the request id', () => {
    const { reply, send } = makeReply();

    handleChatMutationControllerError(
      new Error('document_parsing_exception: internal index details'),
      reply as never,
      t,
      { sanitizeUnexpected: true }
    );

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'request-1',
        message: 'translated:internal_server_error',
      })
    );
    expect(reply.request.log.error).toHaveBeenCalled();
  });
});
