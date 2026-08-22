import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import type { IChat } from '@core/common/interfaces/IChat';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';

interface VariableResolutionHarness {
  buildApiRuntimeVariableScope: jest.Mock<Promise<Record<string, unknown>>>;
  canRunAutomation: jest.Mock;
  processHolidayNode: jest.Mock;
  processNextNode: (
    t: (key: string) => string,
    chat: IChat,
    flow: ListChatbotFlowResponse,
    nodeId: string
  ) => Promise<boolean>;
  resolveCompatibleNodeVariables: (
    t: (key: string) => string,
    chat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ) => Promise<void>;
  updateCache: jest.Mock;
}

const createHarness = (
  scope: Record<string, unknown>
): VariableResolutionHarness => {
  const flowRuntimeContextService = {
    load: jest.fn(async () => ({
      outputs: { api_1: {} },
      captures: { message_1: {} },
    })),
  };
  const dependencies = [
    ...Array.from({ length: 24 }, () => ({})),
    flowRuntimeContextService,
    {},
  ];
  const service = Reflect.construct(
    ChatbotFlowRunnerService,
    dependencies
  ) as ChatbotFlowRunnerService;
  const harness = service as unknown as VariableResolutionHarness;
  harness.buildApiRuntimeVariableScope = jest.fn(async () => scope);
  harness.canRunAutomation = jest.fn(async () => true);
  harness.processHolidayNode = jest.fn(async () => true);
  harness.updateCache = jest.fn(async () => undefined);
  return harness;
};

describe('ChatbotFlowRunnerService API variable rendering', () => {
  it('renders human fields and preserves native values in payloads', async () => {
    const harness = createHarness({
      api_1: {
        names: ['Ana', 'Bruno'],
        profile: { id: 7, active: true },
      },
    });
    const chat = {
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
    } as IChat;
    const node = {
      id: 'message-1',
      type: 'message',
      position: { x: 0, y: 0 },
      data: {
        message: '{{ api_1.names }}',
        annotation: '{{ api_1.profile }}',
        payload: { value: '{{ api_1.names }}' },
        apiRequest: { body: '{{ api_1.profile }}' },
        conditionalVariable: '{{ api_1.profile.active }}',
        attachmentVariable: '{{ api_1.profile.id }}',
      },
    } as unknown as ListChatbotFlowResponse['nodes'][number];

    await harness.resolveCompatibleNodeVariables((key) => key, chat, node);

    expect(node.data).toMatchObject({
      message: 'Ana, Bruno',
      annotation: '{"id":7,"active":true}',
      payload: { value: ['Ana', 'Bruno'] },
      apiRequest: { body: '{{ api_1.profile }}' },
      conditionalVariable: '{{ api_1.profile.active }}',
      attachmentVariable: '{{ api_1.profile.id }}',
    });
  });

  it('preserves case-insensitive holiday placeholders while resolving upstream variables', async () => {
    const harness = createHarness({
      api_1: {
        names: ['Ana', 'Bruno'],
      },
    });
    const chat = {
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
    } as IChat;
    const node = {
      id: 'holiday-1',
      type: 'holiday',
      position: { x: 0, y: 0 },
      data: {
        holidayMessage:
          'Feriados: {{ HOLIDAY_NAMES }} | {{  holiday_tags  }} | {{ api_1.names }}',
      },
    } as unknown as ListChatbotFlowResponse['nodes'][number];

    await harness.resolveCompatibleNodeVariables((key) => key, chat, node);

    expect(node.data.holidayMessage).toBe(
      'Feriados: {{ HOLIDAY_NAMES }} | {{  holiday_tags  }} | Ana, Bruno'
    );
  });

  it('still rejects an arbitrary missing variable in a holiday message', async () => {
    const harness = createHarness({
      api_1: {
        names: ['Ana'],
      },
    });
    const chat = {
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
    } as IChat;
    const node = {
      id: 'holiday-1',
      type: 'holiday',
      position: { x: 0, y: 0 },
      data: {
        holidayMessage:
          '{{ holiday_names }} | {{ api_1.names }} | {{ missing_holiday_value }}',
      },
    } as unknown as ListChatbotFlowResponse['nodes'][number];

    await expect(
      harness.resolveCompatibleNodeVariables((key) => key, chat, node)
    ).rejects.toThrow(
      'Variable "missing_holiday_value" is not available in this flow context'
    );
  });

  it('dispatches a holiday node after resolving it with a non-empty runtime context', async () => {
    const harness = createHarness({
      message_1: {
        text: 'Brasil',
      },
    });
    const chat = {
      chat_id: 'chat-1',
      account: { id: 'account-1' },
      worker: { id: 'worker-1' },
    } as IChat;
    const holidayNode = {
      id: 'holiday-1',
      type: 'holiday',
      position: { x: 0, y: 0 },
      data: {
        holidayMessage:
          '{{ HOLIDAY_NAMES }} | {{ holiday_tags }} | {{ message_1.text }}',
      },
    } as unknown as ListChatbotFlowResponse['nodes'][number];
    const flow = {
      chatbot_flow_id: 'flow-1',
      chatbot_id: 'chatbot-1',
      account_id: 'account-1',
      nodes: [holidayNode],
      edges: [],
    } as ListChatbotFlowResponse;
    const translate = (key: string) => key;

    await expect(
      harness.processNextNode(translate, chat, flow, 'holiday-1')
    ).resolves.toBe(true);

    expect(holidayNode.data.holidayMessage).toBe(
      '{{ HOLIDAY_NAMES }} | {{ holiday_tags }} | Brasil'
    );
    expect(harness.processHolidayNode).toHaveBeenCalledWith(
      translate,
      chat,
      flow,
      'holiday-1',
      undefined,
      undefined
    );
  });
});
