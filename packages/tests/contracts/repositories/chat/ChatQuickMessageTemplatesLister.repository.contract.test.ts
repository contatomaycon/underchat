import 'reflect-metadata';
import { ChatQuickMessageTemplatesListerRepository } from '@core/repositories/chat/ChatQuickMessageTemplatesLister.repository';

function createQueryChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn(() => ({ orderBy }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatQuickMessageTemplatesListerRepository', () => {
  it('returns empty array when there are no quick templates', async () => {
    const chain = createQueryChain([]);
    const dbRo = { select: chain.select };
    const repository = new ChatQuickMessageTemplatesListerRepository(
      dbRo as never
    );

    await expect(
      repository.listQuickMessageTemplates({} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('maps templates and normalizes nullable fields', async () => {
    const chain = createQueryChain([
      {
        message_template_id: 'tmp-1',
        command: '/help',
        message: 'hi',
        attachment_url: undefined,
        type: 'text',
        mimetype: undefined,
        duration: undefined,
        width: null,
        height: undefined,
        auto_send: undefined,
      },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChatQuickMessageTemplatesListerRepository(
      dbRo as never
    );

    await expect(
      repository.listQuickMessageTemplates(
        {
          command: '/h',
          channel_id: 'channel-1',
        } as never,
        'acc-1'
      )
    ).resolves.toEqual([
      {
        message_template_id: 'tmp-1',
        command: '/help',
        message: 'hi',
        attachment_url: null,
        type: 'text',
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        auto_send: null,
      },
    ]);
  });
});
