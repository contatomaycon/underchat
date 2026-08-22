import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import {
  assertKafkaDispatchActive,
  runWithKafkaDispatchGuard,
} from '@core/common/functions/kafkaDispatchFenceContext';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';

interface MenuScheduleHarness {
  MENU_DEBOUNCE_SECONDS: number;
  canRunAutomation: jest.Mock;
  deleteMenuDebounce: jest.Mock;
  getMenuDebounce: jest.Mock;
  replaceVariables: jest.Mock;
  scheduleMenuSend: (
    t: never,
    chat: IChat,
    nodeData: {
      message: string;
      options: { id: string; text: string }[];
    }
  ) => void;
  sendMessageWithStatusGuard: jest.Mock;
  withAutomationLock: jest.Mock;
}

describe('ChatbotFlowRunnerService Kafka guard isolation', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sends a debounced menu after the originating event lease is released', async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = Object.create(
      ChatbotFlowRunnerService.prototype
    ) as MenuScheduleHarness;
    const chat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Acme' },
      worker: { id: 'worker-1', name: 'WhatsApp' },
      user: null,
      sector: null,
    } as unknown as IChat;
    const nodeData = {
      message: 'Escolha uma opção',
      options: [{ id: 'option-1', text: 'Atendimento' }],
    };
    let eventLeaseOwned = true;
    let menuSent = false;
    const eventGuard = jest.fn(() => {
      if (!eventLeaseOwned) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    service.MENU_DEBOUNCE_SECONDS = 0;
    service.withAutomationLock = jest.fn(
      async (_chat: IChat, callback: () => Promise<void>) => callback()
    );
    service.getMenuDebounce = jest.fn(async () => ({
      expiresAt: Date.now() - 1,
      nodeData,
    }));
    service.canRunAutomation = jest.fn(async () => true);
    service.deleteMenuDebounce = jest.fn(async () => undefined);
    service.replaceVariables = jest.fn(
      async (_t: unknown, message: string) => message
    );
    service.sendMessageWithStatusGuard = jest.fn(async () => {
      await assertKafkaDispatchActive();
      menuSent = true;
      return true;
    });

    runWithKafkaDispatchGuard(eventGuard, () => {
      service.scheduleMenuSend({} as never, chat, nodeData);
    });
    eventLeaseOwned = false;

    await jest.advanceTimersByTimeAsync(500);

    expect(menuSent).toBe(true);
    expect(eventGuard).not.toHaveBeenCalled();
    expect(service.deleteMenuDebounce).toHaveBeenCalledWith(chat);
    expect(service.sendMessageWithStatusGuard).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
