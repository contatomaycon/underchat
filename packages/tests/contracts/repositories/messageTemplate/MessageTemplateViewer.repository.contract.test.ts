import 'reflect-metadata';
import { MessageTemplateViewerRepository } from '@core/repositories/messageTemplate/MessageTemplateViewer.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.execute = execute;

  return {
    dbRo: {
      select: jest.fn(() => chain),
    },
    execute,
  };
}

describe('MessageTemplateViewerRepository', () => {
  it('returns null when template does not exist', async () => {
    const { dbRo, execute } = createDbRoWithExecuteQueue([[]]);
    const repository = new MessageTemplateViewerRepository(dbRo as never);

    await expect(
      repository.viewMessageTemplateById('tmpl-1')
    ).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns template with relation channel ids and default type', async () => {
    const templateRows = [
      {
        message_template_id: 'tmpl-1',
        channel_id: 'fallback',
        account: { account_id: 'acc-1', name: 'Conta' },
        message_status: { message_status_id: 'status-1', name: 'Active' },
        attachment_url: null,
        command: '/start',
        message: 'hello',
        type: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        auto_send: false,
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ];

    const channelRows = [{ channel_id: 'ch-1' }, { channel_id: 'ch-2' }];

    const { dbRo } = createDbRoWithExecuteQueue([templateRows, channelRows]);
    const repository = new MessageTemplateViewerRepository(dbRo as never);

    await expect(repository.viewMessageTemplateById('tmpl-1')).resolves.toEqual(
      expect.objectContaining({
        message_template_id: 'tmpl-1',
        channel_ids: ['ch-1', 'ch-2'],
        type: 'text',
      })
    );
  });

  it('falls back to single channel_id when relation table has no rows', async () => {
    const templateRows = [
      {
        message_template_id: 'tmpl-1',
        channel_id: 'fallback',
        account: { account_id: 'acc-1', name: 'Conta' },
        message_status: { message_status_id: 'status-1', name: 'Active' },
        attachment_url: null,
        command: '/start',
        message: 'hello',
        type: 'image',
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        auto_send: false,
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ];

    const { dbRo } = createDbRoWithExecuteQueue([templateRows, []]);
    const repository = new MessageTemplateViewerRepository(dbRo as never);

    await expect(repository.viewMessageTemplateById('tmpl-1')).resolves.toEqual(
      expect.objectContaining({
        channel_ids: ['fallback'],
        type: 'image',
      })
    );
  });
});
