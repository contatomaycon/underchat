import 'reflect-metadata';

jest.mock(
  '@core/repositories/randomMessage/RandomMessageLister.repository',
  () => ({
    RandomMessageListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageCreator.repository',
  () => ({
    RandomMessageCreatorRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageViewer.repository',
  () => ({
    RandomMessageViewerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageUpdater.repository',
  () => ({
    RandomMessageUpdaterRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageDeleter.repository',
  () => ({
    RandomMessageDeleterRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageItemLister.repository',
  () => ({
    RandomMessageItemListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageItemCreator.repository',
  () => ({
    RandomMessageItemCreatorRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageItemViewer.repository',
  () => ({
    RandomMessageItemViewerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageItemUpdater.repository',
  () => ({
    RandomMessageItemUpdaterRepository: class {},
  })
);
jest.mock(
  '@core/repositories/randomMessage/RandomMessageItemDeleter.repository',
  () => ({
    RandomMessageItemDeleterRepository: class {},
  })
);

import { RandomMessageService } from '@core/services/randomMessage.service';

describe('RandomMessageService', () => {
  const makeService = () => {
    const randomMessageListerRepository = {
      listRandomMessages: jest.fn(async () => [
        {
          random_message_id: 'rm-1',
          name: 'Message 1',
          status: 'active',
        },
      ]),
      listRandomMessageTotal: jest.fn(async () => 1),
      listActiveRandomMessagesForChatbot: jest.fn(async () => [
        {
          random_message_id: 'rm-1',
          name: 'Message 1',
        },
      ]),
    };

    const randomMessageCreatorRepository = {
      createRandomMessage: jest.fn(async () => 'rm-1'),
    };

    const randomMessageViewerRepository = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
        name: 'Message 1',
        status: 'active',
      })),
    };

    const randomMessageUpdaterRepository = {
      updateRandomMessageById: jest.fn(async () => true),
    };

    const randomMessageDeleterRepository = {
      deleteRandomMessageById: jest.fn(async () => true),
    };

    const randomMessageItemListerRepository = {
      listRandomMessageItems: jest.fn(async () => [
        {
          random_message_item_id: 'rmi-1',
          message: 'Hello',
        },
      ]),
      listRandomMessageItemTotal: jest.fn(async () => 1),
      listActiveRandomMessageItemsForRunner: jest.fn(async () => [
        {
          random_message_item_id: 'rmi-1',
          message: 'Hello',
          type: 'text',
          attachment_url: null,
          mimetype: null,
          duration: null,
          width: null,
          height: null,
        },
      ]),
    };

    const randomMessageItemCreatorRepository = {
      createRandomMessageItem: jest.fn(async () => 'rmi-1'),
    };

    const randomMessageItemViewerRepository = {
      viewRandomMessageItemById: jest.fn(async () => ({
        random_message_item_id: 'rmi-1',
        message: 'Hello',
        status: 'active',
      })),
    };

    const randomMessageItemUpdaterRepository = {
      updateRandomMessageItemById: jest.fn(async () => true),
    };

    const randomMessageItemDeleterRepository = {
      deleteRandomMessageItemById: jest.fn(async () => true),
    };

    const service = new RandomMessageService(
      randomMessageListerRepository as never,
      randomMessageCreatorRepository as never,
      randomMessageViewerRepository as never,
      randomMessageUpdaterRepository as never,
      randomMessageDeleterRepository as never,
      randomMessageItemListerRepository as never,
      randomMessageItemCreatorRepository as never,
      randomMessageItemViewerRepository as never,
      randomMessageItemUpdaterRepository as never,
      randomMessageItemDeleterRepository as never
    );

    return {
      service,
      randomMessageListerRepository,
      randomMessageCreatorRepository,
      randomMessageViewerRepository,
      randomMessageUpdaterRepository,
      randomMessageDeleterRepository,
      randomMessageItemListerRepository,
      randomMessageItemCreatorRepository,
      randomMessageItemViewerRepository,
      randomMessageItemUpdaterRepository,
      randomMessageItemDeleterRepository,
    };
  };

  it('lists random messages with total using both repository methods', async () => {
    const { service, randomMessageListerRepository } = makeService();

    await expect(
      service.listRandomMessages(
        10,
        1,
        { search: 'abc', status: 'active' } as never,
        'acc-1'
      )
    ).resolves.toEqual([
      [
        {
          random_message_id: 'rm-1',
          name: 'Message 1',
          status: 'active',
        },
      ],
      1,
    ]);

    expect(
      randomMessageListerRepository.listRandomMessages
    ).toHaveBeenCalledWith(10, 1, { search: 'abc', status: 'active' }, 'acc-1');
    expect(
      randomMessageListerRepository.listRandomMessageTotal
    ).toHaveBeenCalledWith({ search: 'abc', status: 'active' }, 'acc-1');
  });

  it('creates, views, updates and deletes random messages', async () => {
    const {
      service,
      randomMessageCreatorRepository,
      randomMessageViewerRepository,
      randomMessageUpdaterRepository,
      randomMessageDeleterRepository,
    } = makeService();

    const createInput = {
      account_id: 'acc-1',
      name: 'Message 1',
      status: 'active',
    };
    await expect(service.createRandomMessage(createInput)).resolves.toBe(
      'rm-1'
    );
    expect(
      randomMessageCreatorRepository.createRandomMessage
    ).toHaveBeenCalledWith(createInput);

    await expect(
      service.viewRandomMessageById('rm-1', 'acc-1')
    ).resolves.toEqual({
      random_message_id: 'rm-1',
      name: 'Message 1',
      status: 'active',
    });
    expect(
      randomMessageViewerRepository.viewRandomMessageById
    ).toHaveBeenCalledWith('rm-1', 'acc-1');

    const updateInput = {
      random_message_id: 'rm-1',
      account_id: 'acc-1',
      name: 'Renamed',
      status: 'inactive',
    };
    await expect(service.updateRandomMessageById(updateInput)).resolves.toBe(
      true
    );
    expect(
      randomMessageUpdaterRepository.updateRandomMessageById
    ).toHaveBeenCalledWith(updateInput);

    await expect(
      service.deleteRandomMessageById('rm-1', 'acc-1')
    ).resolves.toBe(true);
    expect(
      randomMessageDeleterRepository.deleteRandomMessageById
    ).toHaveBeenCalledWith('rm-1', 'acc-1');
  });

  it('lists random message items with total and performs item CRUD delegation', async () => {
    const {
      service,
      randomMessageItemListerRepository,
      randomMessageItemCreatorRepository,
      randomMessageItemViewerRepository,
      randomMessageItemUpdaterRepository,
      randomMessageItemDeleterRepository,
    } = makeService();

    await expect(
      service.listRandomMessageItems(
        20,
        2,
        { search: 'hello', status: 'active' } as never,
        'rm-1',
        'acc-1'
      )
    ).resolves.toEqual([
      [
        {
          random_message_item_id: 'rmi-1',
          message: 'Hello',
        },
      ],
      1,
    ]);

    expect(
      randomMessageItemListerRepository.listRandomMessageItems
    ).toHaveBeenCalledWith(
      20,
      2,
      { search: 'hello', status: 'active' },
      'rm-1',
      'acc-1'
    );
    expect(
      randomMessageItemListerRepository.listRandomMessageItemTotal
    ).toHaveBeenCalledWith(
      { search: 'hello', status: 'active' },
      'rm-1',
      'acc-1'
    );

    const createItemInput = {
      random_message_id: 'rm-1',
      account_id: 'acc-1',
      message: 'Hello',
      status: 'active',
      type: 'text',
      attachment_url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
    };

    await expect(
      service.createRandomMessageItem(createItemInput)
    ).resolves.toBe('rmi-1');
    expect(
      randomMessageItemCreatorRepository.createRandomMessageItem
    ).toHaveBeenCalledWith(createItemInput);

    await expect(
      service.viewRandomMessageItemById('rmi-1', 'rm-1', 'acc-1')
    ).resolves.toEqual({
      random_message_item_id: 'rmi-1',
      message: 'Hello',
      status: 'active',
    });
    expect(
      randomMessageItemViewerRepository.viewRandomMessageItemById
    ).toHaveBeenCalledWith('rmi-1', 'rm-1', 'acc-1');

    const updateItemInput = {
      random_message_item_id: 'rmi-1',
      random_message_id: 'rm-1',
      account_id: 'acc-1',
      message: 'Updated',
      status: 'inactive',
      type: 'text',
      attachment_url: null,
      mimetype: null,
      duration: null,
      width: null,
      height: null,
    };

    await expect(
      service.updateRandomMessageItemById(updateItemInput)
    ).resolves.toBe(true);
    expect(
      randomMessageItemUpdaterRepository.updateRandomMessageItemById
    ).toHaveBeenCalledWith(updateItemInput);

    await expect(
      service.deleteRandomMessageItemById('rmi-1', 'rm-1', 'acc-1')
    ).resolves.toBe(true);
    expect(
      randomMessageItemDeleterRepository.deleteRandomMessageItemById
    ).toHaveBeenCalledWith('rmi-1', 'rm-1', 'acc-1');
  });

  it('lists active random messages and active random message items', async () => {
    const {
      service,
      randomMessageListerRepository,
      randomMessageItemListerRepository,
    } = makeService();

    await expect(
      service.listActiveRandomMessagesForChatbot('acc-1')
    ).resolves.toEqual([
      {
        random_message_id: 'rm-1',
        name: 'Message 1',
      },
    ]);
    expect(
      randomMessageListerRepository.listActiveRandomMessagesForChatbot
    ).toHaveBeenCalledWith('acc-1');

    await expect(
      service.listActiveRandomMessageItemsForRunner('rm-1', 'acc-1')
    ).resolves.toEqual([
      {
        random_message_item_id: 'rmi-1',
        message: 'Hello',
        type: 'text',
        attachment_url: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
      },
    ]);
    expect(
      randomMessageItemListerRepository.listActiveRandomMessageItemsForRunner
    ).toHaveBeenCalledWith('rm-1', 'acc-1');
  });

  it('propagates listing errors when one repository call fails', async () => {
    const { service, randomMessageListerRepository } = makeService();

    randomMessageListerRepository.listRandomMessageTotal.mockRejectedValueOnce(
      new Error('total failed')
    );

    await expect(
      service.listRandomMessages(10, 1, {} as never, 'acc-1')
    ).rejects.toThrow('total failed');
  });
});
