import 'reflect-metadata';

import { container } from 'tsyringe';
import { sendOfficialTemplate } from '@core/controllers/chat/methods/sendOfficialTemplate';

function makeReply() {
  const reply = {
    request: { id: 'request-1' },
    code: jest.fn(),
    send: jest.fn(),
  };
  reply.code.mockReturnValue(reply);
  reply.send.mockReturnValue(reply);
  return reply;
}

describe('sendOfficialTemplate controller', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports queue acceptance without claiming that WhatsApp sent the template', async () => {
    const chat = { chat_id: 'chat-1' };
    const execute = jest.fn().mockResolvedValue(chat);
    jest.spyOn(container, 'resolve').mockReturnValue({ execute } as never);
    const translate = jest.fn((key: string) => {
      if (key === 'official_template_queued_successfully') {
        return 'Template queued for processing. WhatsApp confirmation will be updated on the message.';
      }
      if (key === 'official_template_sent_successfully') {
        return 'Official template sent successfully!';
      }
      return key;
    });
    const request = {
      params: { chat_id: 'chat-1' },
      body: { template_id: 'template-1', variables: [] },
      t: translate,
      tokenJwtData: {
        account_id: 'account-1',
        user_id: 'user-1',
        actions: [],
        sectors: [],
        channels: [],
      },
    };
    const reply = makeReply();

    await sendOfficialTemplate(request as never, reply as never);

    expect(translate).toHaveBeenCalledWith(
      'official_template_queued_successfully'
    );
    expect(translate).not.toHaveBeenCalledWith(
      'official_template_sent_successfully'
    );
    expect(reply.code).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'request-1',
      status: true,
      message:
        'Template queued for processing. WhatsApp confirmation will be updated on the message.',
      data: chat,
    });
    expect(reply.send.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/sent successfully/iu),
      })
    );
  });
});
