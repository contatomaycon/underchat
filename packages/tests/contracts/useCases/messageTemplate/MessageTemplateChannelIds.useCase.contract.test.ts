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

function createUpdaterUseCase(options?: { channelExists?: boolean }) {
  const messageTemplateService = {
    viewMessageTemplateById: jest.fn(async () => ({ type: 'text' })),
    existsMessageStatusById: jest.fn(async () => true),
    updateMessageTemplateById: jest.fn(async () => true),
  };
  const workerService = {
    existsWorkerById: jest.fn(async () => options?.channelExists ?? true),
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
});
