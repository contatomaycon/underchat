import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

jest.mock('@core/services/converter', () => ({
  ConverterService: class {},
}));

jest.mock('@core/services/messageTemplate.service', () => ({
  MessageTemplateService: class {},
}));

jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));

import { MessageTemplateCreatorUseCase } from '@core/useCases/messageTemplate/MessageTemplateCreator.useCase';
import { MessageTemplateUpdaterUseCase } from '@core/useCases/messageTemplate/MessageTemplateUpdater.useCase';

const channelId1 = '019b6fa0-54d3-7000-92ce-ad33e88cb0fe';
const channelId2 = '019b6fa0-8371-7001-9e69-cebfb0057cf1';
const statusId = '019b6fa0-a553-7002-8776-30c73a50adef';

const t = ((key: string) => key) as never;

function createCreatorUseCase(options?: { channelExists?: boolean }) {
  const messageTemplateService = {
    existsMessageStatusById: jest.fn(async () => true),
    createMessageTemplate: jest.fn(async () => 'message-template-id'),
  };
  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };
  const workerService = {
    existsWorkerById: jest.fn(async () => options?.channelExists ?? true),
  };

  const useCase = new MessageTemplateCreatorUseCase(
    messageTemplateService as never,
    accountService as never,
    {} as never,
    {} as never,
    workerService as never
  );

  return { useCase, messageTemplateService, workerService };
}

function createUpdaterUseCase(options?: {
  channelExists?: boolean | ((channelId: string) => boolean);
  currentChannelIds?: string[];
}) {
  const messageTemplateService = {
    viewMessageTemplateById: jest.fn(async () => ({
      type: 'text',
      channel_ids: options?.currentChannelIds ?? [],
      account: { account_id: 'acc-1' },
    })),
    existsMessageStatusById: jest.fn(async () => true),
    updateMessageTemplateById: jest.fn(async () => true),
  };
  const workerService = {
    existsWorkerById: jest.fn(async (_accountId: string, channelId: string) =>
      typeof options?.channelExists === 'function'
        ? options.channelExists(channelId)
        : (options?.channelExists ?? true)
    ),
  };

  const useCase = new MessageTemplateUpdaterUseCase(
    messageTemplateService as never,
    {} as never,
    {} as never,
    workerService as never
  );

  return { useCase, messageTemplateService, workerService };
}

describe('MessageTemplate channel_ids use cases', () => {
  it('normalizes multipart repeated channel fields on create', async () => {
    const { useCase, messageTemplateService, workerService } =
      createCreatorUseCase();

    await expect(
      useCase.execute(
        t,
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [{ value: channelId1 }, { value: channelId2 }],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(workerService.existsWorkerById).toHaveBeenCalledTimes(2);
    expect(messageTemplateService.createMessageTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [channelId1, channelId2],
      })
    );
  });

  it('normalizes multipart repeated channel fields on update', async () => {
    const { useCase, messageTemplateService, workerService } =
      createUpdaterUseCase();

    await expect(
      useCase.execute(
        t,
        '019b6fa2-413d-7003-9632-d09f2745ee75',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [{ value: channelId1 }, { value: channelId2 }],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(workerService.existsWorkerById).toHaveBeenCalledTimes(2);
    expect(
      messageTemplateService.updateMessageTemplateById
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [channelId1, channelId2],
      })
    );
  });

  it('clears channel mappings on update with null-like values', async () => {
    const { useCase, messageTemplateService, workerService } =
      createUpdaterUseCase();

    await expect(
      useCase.execute(
        t,
        '019b6fa2-678c-7004-ab0c-2ac4479f20b7',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: { value: null },
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(workerService.existsWorkerById).not.toHaveBeenCalled();
    expect(
      messageTemplateService.updateMessageTemplateById
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [],
      })
    );
  });

  it('clears channel mappings from the multipart null string wrapper', async () => {
    const { useCase, messageTemplateService, workerService } =
      createUpdaterUseCase({ currentChannelIds: [channelId1] });

    await expect(
      useCase.execute(
        t,
        '019b6fa2-7a4c-7004-b367-a1dc05db05a4',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: {
            type: 'field',
            fieldname: 'channel_ids',
            value: 'null',
          },
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(workerService.existsWorkerById).not.toHaveBeenCalled();
    expect(
      messageTemplateService.updateMessageTemplateById
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [],
      })
    );
  });

  it('clears channel mappings from an explicit empty array', async () => {
    const { useCase, messageTemplateService, workerService } =
      createUpdaterUseCase({ currentChannelIds: [channelId1] });

    await expect(
      useCase.execute(
        t,
        '019b6fa2-8c6e-7004-a406-130d98da27df',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(workerService.existsWorkerById).not.toHaveBeenCalled();
    expect(
      messageTemplateService.updateMessageTemplateById
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [],
      })
    );
  });

  it('keeps nonexistent valid channel ids as domain errors on update', async () => {
    const { useCase, messageTemplateService } = createUpdaterUseCase({
      channelExists: false,
    });

    await expect(
      useCase.execute(
        t,
        '019b6fa2-916d-7005-941a-79a6824e11d2',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [{ value: channelId1 }],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('worker_not_found');

    expect(
      messageTemplateService.updateMessageTemplateById
    ).not.toHaveBeenCalled();
  });

  it('drops a deleted previous channel while replacing it with an active channel', async () => {
    const { useCase, messageTemplateService } = createUpdaterUseCase({
      currentChannelIds: [channelId1],
      channelExists: (channelId) => channelId === channelId2,
    });

    await expect(
      useCase.execute(
        t,
        '019b6fa2-c083-7006-9779-9f13a491d184',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [{ value: channelId1 }, { value: channelId2 }],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(
      messageTemplateService.updateMessageTemplateById
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_ids: [channelId2],
      })
    );
  });

  it('does not forgive an inactive channel that was not already linked', async () => {
    const { useCase, messageTemplateService } = createUpdaterUseCase({
      currentChannelIds: [channelId1],
      channelExists: false,
    });

    await expect(
      useCase.execute(
        t,
        '019b6fa2-e648-7007-a571-f3b9aed813ec',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [{ value: channelId2 }],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('worker_not_found');

    expect(
      messageTemplateService.updateMessageTemplateById
    ).not.toHaveBeenCalled();
  });

  it('does not update a template owned by another account', async () => {
    const { useCase, messageTemplateService, workerService } =
      createUpdaterUseCase();

    messageTemplateService.viewMessageTemplateById.mockResolvedValueOnce({
      type: 'text',
      channel_ids: [channelId1],
      account: { account_id: 'another-account' },
    });

    await expect(
      useCase.execute(
        t,
        '019b6fa3-0d74-7008-8442-5da2632ae481',
        {
          message: { value: 'hello' },
          command: { value: 'start' },
          channel_ids: [{ value: channelId1 }],
          message_status_id: { value: statusId },
          type: { value: 'text' },
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('message_template_not_found');

    expect(workerService.existsWorkerById).not.toHaveBeenCalled();
    expect(
      messageTemplateService.updateMessageTemplateById
    ).not.toHaveBeenCalled();
  });
});
