import 'reflect-metadata';

import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { ContactCreationClientError } from '@core/common/exceptions/ContactCreationClientError';
import { handleContactCreationControllerError } from '@core/common/functions/handleContactCreationControllerError';

function makeReply() {
  const send = jest.fn();
  const reply = {
    request: { id: 'request-1' },
    code: jest.fn(() => ({ send })),
  };
  return { reply, send };
}

describe('handleContactCreationControllerError', () => {
  const t = ((key: string) => `translated:${key}`) as never;

  it.each([
    [EHTTPStatusCode.bad_request, 'invalid_phone'],
    [EHTTPStatusCode.forbidden, 'channel_not_allowed'],
    [EHTTPStatusCode.not_found, 'label_not_found'],
    [EHTTPStatusCode.conflict, 'contact_already_exists'],
  ] as const)(
    'maps an expected client failure to HTTP %i',
    (statusCode, reason) => {
      const { reply, send } = makeReply();
      const message = `translated:${reason}`;

      handleContactCreationControllerError(
        new ContactCreationClientError(message, statusCode),
        reply as never,
        t
      );

      expect(reply.code).toHaveBeenCalledWith(statusCode);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ status: false, message })
      );
    }
  );

  it.each([
    'phone_validation_transport_failed',
    'translated:contact_creation_failed',
  ])('keeps the unexpected failure %s as HTTP 500', (message) => {
    const { reply, send } = makeReply();

    handleContactCreationControllerError(new Error(message), reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        message,
      })
    );
  });
});
