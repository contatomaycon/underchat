import 'reflect-metadata';
import { MessageTemplateUpdaterRepository } from '@core/repositories/messageTemplate/MessageTemplateUpdater.repository';

function createUpdateChain(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    update,
    set,
  };
}

function createDeleteChain() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  const del = jest.fn(() => ({ where }));

  return {
    del,
  };
}

function createInsertChain() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const onConflictDoNothing = jest.fn(() => ({ execute }));
  const values = jest.fn(() => ({ onConflictDoNothing }));
  const insert = jest.fn(() => ({ values }));

  return {
    insert,
    values,
    onConflictDoNothing,
  };
}

function createRepository(updateRowCount = 1) {
  const updateChain = createUpdateChain(updateRowCount);
  const deleteChain = createDeleteChain();
  const insertChain = createInsertChain();

  const dbRw = {
    update: updateChain.update,
    delete: deleteChain.del,
    insert: insertChain.insert,
  };

  return {
    repository: new MessageTemplateUpdaterRepository(dbRw as never),
    set: updateChain.set,
    del: deleteChain.del,
    values: insertChain.values,
    onConflictDoNothing: insertChain.onConflictDoNothing,
  };
}

describe('MessageTemplateUpdaterRepository', () => {
  it('updates message template without channel synchronization', async () => {
    const { repository, set, del, values } = createRepository();

    await expect(
      repository.updateMessageTemplateById({
        message_template_id: 'tmpl-1',
        command: '/start',
        message: 'hello',
        message_status_id: 'status-1',
        type: 'text',
      } as never)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/start',
        message: 'hello',
        message_status_id: 'status-1',
        type: 'text',
      })
    );
    expect(del).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it('syncs empty channel list by deleting relations only', async () => {
    const { repository, set, del, values } = createRepository();

    await expect(
      repository.updateMessageTemplateById({
        message_template_id: 'tmpl-1',
        channel_ids: [],
        auto_send: false,
      } as never)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: null,
        auto_send: false,
      })
    );
    expect(del).toHaveBeenCalledTimes(1);
    expect(values).not.toHaveBeenCalled();
  });

  it('syncs channels and returns false when update rowCount is zero', async () => {
    const { repository, set, values, onConflictDoNothing } =
      createRepository(0);

    await expect(
      repository.updateMessageTemplateById({
        message_template_id: 'tmpl-1',
        channel_ids: ['ch-1', 'ch-2'],
        attachment_url: null,
        mimetype: 'image/png',
        duration: 12,
        width: 720,
        height: 480,
        auto_send: true,
      } as never)
    ).resolves.toBe(false);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: null,
        attachment_url: undefined,
        mimetype: 'image/png',
        duration: 12,
        width: 720,
        height: 480,
        auto_send: true,
      })
    );
    expect(values).toHaveBeenCalledWith([
      { message_template_id: 'tmpl-1', channel_id: 'ch-1' },
      { message_template_id: 'tmpl-1', channel_id: 'ch-2' },
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});
