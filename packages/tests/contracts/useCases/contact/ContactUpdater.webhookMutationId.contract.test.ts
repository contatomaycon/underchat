import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));
jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

import { buildContactUpdateWebhookMutationId } from '@core/useCases/contact/ContactUpdater.useCase';

describe('ContactUpdaterUseCase webhook mutation identity', () => {
  it('never traverses a circular multipart photo stream', () => {
    const upload = { filename: 'avatar.png', mimetype: 'image/png' } as Record<
      string,
      unknown
    >;
    upload.self = upload;

    expect(() =>
      buildContactUpdateWebhookMutationId('contact-1', '42', {
        name: 'Maycon',
        photo: upload,
      } as never)
    ).not.toThrow();
  });

  it('unwraps circular multipart fields when generating the identity', () => {
    const fields = {} as Record<string, unknown>;
    const channelIdsField = {
      value: ['01900000-0000-7000-8000-000000000004'],
      fields,
    };
    fields.channel_ids = channelIdsField;

    const multipartMutationId = buildContactUpdateWebhookMutationId(
      'contact-1',
      '42',
      {
        channel_ids: channelIdsField,
      } as never
    );
    const plainMutationId = buildContactUpdateWebhookMutationId(
      'contact-1',
      '42',
      {
        channel_ids: ['01900000-0000-7000-8000-000000000004'],
      }
    );

    expect(multipartMutationId).toBe(plainMutationId);
  });

  it('is stable without an upload and isolates separate upload operations', () => {
    const scalar = { name: 'Maycon', phone: '61999999999' } as never;
    expect(buildContactUpdateWebhookMutationId('contact-1', '42', scalar)).toBe(
      buildContactUpdateWebhookMutationId('contact-1', '42', scalar)
    );

    const withUpload = {
      name: 'Maycon',
      photo: { filename: 'avatar.png' },
    } as never;
    expect(
      buildContactUpdateWebhookMutationId('contact-1', '42', withUpload)
    ).not.toBe(
      buildContactUpdateWebhookMutationId('contact-1', '42', withUpload)
    );
  });
});
