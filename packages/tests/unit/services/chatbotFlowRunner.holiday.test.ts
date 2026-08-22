import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import type { IChat } from '@core/common/interfaces/IChat';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';

interface HolidayRunnerHarness {
  processHolidayNode: (
    t: never,
    chat: IChat,
    flow: ListChatbotFlowResponse,
    nodeId: string
  ) => Promise<boolean>;
  processNextNode: jest.Mock;
  replaceVariables: jest.Mock;
  sendMessageWithStatusGuard: jest.Mock;
  updateCache: jest.Mock;
}

const chat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'Acme' },
  worker: { id: 'worker-1', name: 'WhatsApp' },
  user: null,
  sector: null,
} as unknown as IChat;

const holidayNode = {
  id: 'holiday-1',
  type: 'holiday',
  position: { x: 0, y: 0 },
  data: {
    holidayMessage:
      'Hoje: {{ holiday_names }} | Marcadores: {{ holiday_tags }}',
    options: [
      { id: 'is-holiday', text: 'É feriado', required: true },
      { id: 'not-holiday', text: 'Não é feriado', required: true },
    ],
  },
} as ListChatbotFlowResponse['nodes'][number];

const flow: ListChatbotFlowResponse = {
  chatbot_flow_id: 'flow-1',
  chatbot_id: 'chatbot-1',
  account_id: 'account-1',
  nodes: [
    holidayNode,
    {
      id: 'holiday-target',
      type: 'message',
      position: { x: 1, y: 0 },
      data: {},
    },
    {
      id: 'regular-target',
      type: 'message',
      position: { x: 1, y: 1 },
      data: {},
    },
  ],
  edges: [
    {
      id: 'holiday-edge',
      source: 'holiday-1',
      target: 'holiday-target',
      sourceHandle: 'option-is-holiday-source',
    },
    {
      id: 'regular-edge',
      source: 'holiday-1',
      target: 'regular-target',
      sourceHandle: 'option-not-holiday-source',
    },
  ],
};

const createHarness = (isHoliday: boolean) => {
  const holidayService = {
    resolveHolidaysForDate: jest.fn(async () => ({
      isHoliday,
      holidayNames: isHoliday ? ['Independência do Brasil'] : [],
      holidayTags: isHoliday ? ['#feriado', '#independencia_do_brasil'] : [],
      holidayDetails: [],
    })),
  };
  const dependencies = Array.from({ length: 27 }, () => ({}));
  dependencies[23] = holidayService;
  const service = Reflect.construct(
    ChatbotFlowRunnerService,
    dependencies
  ) as unknown as HolidayRunnerHarness;

  service.processNextNode = jest.fn(async () => true);
  service.replaceVariables = jest.fn(
    async (_t: unknown, message: string) => message
  );
  service.sendMessageWithStatusGuard = jest.fn(async () => true);
  service.updateCache = jest.fn(async () => undefined);

  return { service, holidayService };
};

describe('ChatbotFlowRunnerService holiday node', () => {
  it('renders the holiday message and follows the is-holiday branch', async () => {
    const { service, holidayService } = createHarness(true);

    await expect(
      service.processHolidayNode({} as never, chat, flow, 'holiday-1')
    ).resolves.toBe(true);

    expect(holidayService.resolveHolidaysForDate).toHaveBeenCalledWith(
      'account-1',
      expect.any(Date)
    );
    expect(service.replaceVariables).toHaveBeenCalledWith(
      expect.anything(),
      'Hoje: Independência do Brasil | Marcadores: #feriado #independencia_do_brasil',
      chat,
      null,
      null
    );
    expect(service.sendMessageWithStatusGuard).toHaveBeenCalledWith(
      expect.anything(),
      {
        chat,
        accountId: 'account-1',
        type: EMessageType.text,
        message:
          'Hoje: Independência do Brasil | Marcadores: #feriado #independencia_do_brasil',
        typeUser: ETypeUserChat.bot,
      }
    );
    expect(service.updateCache).toHaveBeenCalledWith(chat, 'holiday-target');
    expect(service.processNextNode).toHaveBeenCalledWith(
      expect.anything(),
      chat,
      flow,
      'holiday-target',
      undefined,
      undefined
    );
  });

  it('does not send a holiday message and follows the not-holiday branch', async () => {
    const { service } = createHarness(false);

    await expect(
      service.processHolidayNode({} as never, chat, flow, 'holiday-1')
    ).resolves.toBe(true);

    expect(service.replaceVariables).not.toHaveBeenCalled();
    expect(service.sendMessageWithStatusGuard).not.toHaveBeenCalled();
    expect(service.updateCache).toHaveBeenCalledWith(chat, 'regular-target');
    expect(service.processNextNode).toHaveBeenCalledWith(
      expect.anything(),
      chat,
      flow,
      'regular-target',
      undefined,
      undefined
    );
  });
});
