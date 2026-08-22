import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

import type { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatLabelUpdaterUseCase } from '@core/useCases/chat/ChatLabelUpdater.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const chatId = '01900000-0000-7000-8000-000000000002';
const oldLabelId = '01900000-0000-7000-8000-000000000003';
const newLabelId = '01900000-0000-7000-8000-000000000004';
const translate = ((key: string) => key) as never;

const makeChat = (
  labelsEpoch: number,
  labelsEventId: string,
  labelId = oldLabelId
): IChat =>
  ({
    chat_id: chatId,
    account: { id: accountId, name: 'Conta' },
    worker: { id: 'worker-1', name: 'Canal' },
    status: EChatStatus.in_chat,
    name: 'Cliente',
    phone: '5561999999999',
    date: '2026-07-10T20:00:00.000Z',
    label: [{ label_template_id: labelId, label: labelId, color: '#fff' }],
    meta: { labels_epoch: labelsEpoch, labels_event_id: labelsEventId },
  }) as IChat;

describe('ChatLabelUpdaterUseCase webhook identity', () => {
  it('persists the source received from the public API controller', async () => {
    const chat = makeChat(10, 'labels-event-10');
    const updatedChat = makeChat(11, 'labels-event-result', newLabelId);
    const chatService = {
      findChatByChatId: jest
        .fn()
        .mockResolvedValueOnce(chat)
        .mockResolvedValueOnce(updatedChat),
      updateChatLabel: jest.fn<Promise<boolean>, unknown[]>(async () => true),
    };
    const useCase = new ChatLabelUpdaterUseCase(
      chatService as never,
      {
        viewLabelTemplatesByIds: jest.fn(async () => [
          {
            label_template_id: newLabelId,
            label: 'Novo',
            color: '#000',
          },
        ]),
      } as never,
      { publishSub: jest.fn(async () => undefined) } as never
    );

    await useCase.execute(
      translate,
      accountId,
      { chat_id: chatId },
      { label_template_ids: [{ value: newLabelId }] },
      [],
      'user-1',
      'public_api'
    );

    expect(chatService.updateChatLabel.mock.calls[0]?.[4]).toMatchObject({
      source: 'public_api',
    });
  });

  it('treats an Elasticsearch label with reordered object keys as unchanged', async () => {
    const chat = makeChat(10, 'labels-event-10', newLabelId);
    chat.label = [
      {
        color: '#000',
        label: 'Novo',
        label_template_id: newLabelId,
      },
    ];
    const chatService = {
      findChatByChatId: jest.fn(async () => chat),
      updateChatLabel: jest.fn<Promise<boolean>, unknown[]>(async () => true),
    };
    const labelTemplateViewerRepository = {
      viewLabelTemplatesByIds: jest.fn(async () => [
        {
          label_template_id: newLabelId,
          label: 'Novo',
          color: '#000',
        },
      ]),
    };
    const useCase = new ChatLabelUpdaterUseCase(
      chatService as never,
      labelTemplateViewerRepository as never,
      { publishSub: jest.fn(async () => undefined) } as never
    );

    await expect(
      useCase.execute(
        translate,
        accountId,
        { chat_id: chatId },
        { label_template_ids: [{ value: newLabelId }] }
      )
    ).resolves.toBe(true);

    expect(chatService.updateChatLabel).not.toHaveBeenCalled();
  });

  it('deduplicates the same snapshot transition and separates a later cycle', async () => {
    const firstSnapshot = makeChat(10, 'labels-event-10');
    const laterCycleSnapshot = makeChat(12, 'labels-event-12');
    const updatedChat = makeChat(11, 'labels-event-result', newLabelId);
    const chatService = {
      findChatByChatId: jest
        .fn()
        .mockResolvedValueOnce(firstSnapshot)
        .mockResolvedValueOnce(updatedChat)
        .mockResolvedValueOnce(firstSnapshot)
        .mockResolvedValueOnce(updatedChat)
        .mockResolvedValueOnce(laterCycleSnapshot)
        .mockResolvedValueOnce(updatedChat),
      updateChatLabel: jest.fn<Promise<boolean>, unknown[]>(async () => true),
    };
    const labelTemplateViewerRepository = {
      viewLabelTemplatesByIds: jest.fn(async () => [
        {
          label_template_id: newLabelId,
          label: 'Novo',
          color: '#000',
        },
      ]),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const useCase = new ChatLabelUpdaterUseCase(
      chatService as never,
      labelTemplateViewerRepository as never,
      centrifugoService as never
    );
    const body = { label_template_ids: [{ value: newLabelId }] };

    await useCase.execute(translate, accountId, { chat_id: chatId }, body);
    await useCase.execute(translate, accountId, { chat_id: chatId }, body);
    await useCase.execute(translate, accountId, { chat_id: chatId }, body);

    const calls = chatService.updateChatLabel.mock.calls;
    const eventIds = calls.map((call) => call[3] as string);
    const keys = calls.map(
      (call) => (call[4] as { idempotencyKey: string }).idempotencyKey
    );
    expect(calls[0]?.[2]).toBe(11);
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(calls[2]?.[2]).toBe(13);
    expect(eventIds[2]).not.toBe(eventIds[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
