import 'reflect-metadata';
import { MessageTemplateListerRepository } from '@core/repositories/messageTemplate/MessageTemplateLister.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.execute = execute;

  return {
    dbRo: {
      select: jest.fn(() => chain),
    },
    execute,
  };
}

describe('MessageTemplateListerRepository', () => {
  it('returns empty list when templates query returns empty', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new MessageTemplateListerRepository(dbRo as never);

    await expect(
      repository.listMessageTemplates(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('maps templates with channel ids from relation table', async () => {
    const templates = [
      {
        message_template_id: 'tmpl-1',
        channel_id: null,
        account: { account_id: 'acc-1', name: 'Conta' },
        message_status: { message_status_id: 'status-1', name: 'Active' },
        command: '/start',
        message: 'hello',
        type: 'text',
        attachment_url: null,
        created_at: '2026-04-21T00:00:00.000Z',
      },
      {
        message_template_id: 'tmpl-2',
        channel_id: 'fallback-channel',
        account: { account_id: 'acc-1', name: 'Conta' },
        message_status: null,
        command: '/ping',
        message: 'pong',
        type: 'text',
        attachment_url: 'url',
        created_at: null,
      },
    ];

    const channels = [
      { message_template_id: 'tmpl-1', channel_id: 'ch-1' },
      { message_template_id: 'tmpl-1', channel_id: 'ch-2' },
    ];

    const { dbRo } = createDbRoWithExecuteQueue([templates, channels]);
    const repository = new MessageTemplateListerRepository(dbRo as never);

    await expect(
      repository.listMessageTemplates(
        10,
        1,
        {
          sort_by: [{ key: 'command', order: 'asc' }],
          command: 'start',
          message_status: 'status-1',
        } as never,
        'acc-1'
      )
    ).resolves.toEqual([
      {
        message_template_id: 'tmpl-1',
        channel_ids: ['ch-1', 'ch-2'],
        account: { account_id: 'acc-1', name: 'Conta' },
        message_status: { message_status_id: 'status-1', name: 'Active' },
        command: '/start',
        message: 'hello',
        attachment_url: null,
        type: 'text',
        created_at: '2026-04-21T00:00:00.000Z',
      },
      {
        message_template_id: 'tmpl-2',
        channel_ids: ['fallback-channel'],
        account: { account_id: 'acc-1', name: 'Conta' },
        message_status: null,
        command: '/ping',
        message: 'pong',
        attachment_url: 'url',
        type: 'text',
        created_at: null,
      },
    ]);
  });

  it('returns template total count', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[{ count: 5 }]]);
    const repository = new MessageTemplateListerRepository(dbRo as never);

    await expect(
      repository.listMessageTemplateTotal({} as never, 'acc-1')
    ).resolves.toBe(5);
  });
});
