import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import type { IChat } from '@core/common/interfaces/IChat';
import { createEmptyChatbotUnderchatLookupOutput } from '@core/common/interfaces/IChatbotUnderchatLookup';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import type { ChatbotFlowRuntimeContext } from '@core/services/chatbotFlowRuntimeContext.service';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';

interface UnderchatRunnerHarness {
  processUnderchatNode: (
    t: never,
    chat: IChat,
    flow: ListChatbotFlowResponse,
    node: ListChatbotFlowResponse['nodes'][number]
  ) => Promise<boolean>;
  processNextNode: jest.Mock;
  buildApiRuntimeVariableScope: jest.Mock;
}

const createHarness = (found: boolean) => {
  let context: ChatbotFlowRuntimeContext = {
    version: 1,
    chatbotId: 'chatbot-1',
    flowId: 'flow-1',
    outputs: {},
    captures: {},
    lookups: {},
    invocations: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const output = found
    ? {
        ...createEmptyChatbotUnderchatLookupOutput(),
        found: true,
        user: {
          ...createEmptyChatbotUnderchatLookupOutput().user,
          email: 'user@example.com',
        },
      }
    : createEmptyChatbotUnderchatLookupOutput();
  const runtimeContextService = {
    load: jest.fn(async () => context),
    create: jest.fn(() => context),
    toVariableScope: jest.fn(() => ({
      data_1: { email: 'user@example.com' },
    })),
    withLookup: jest.fn(
      (
        current: ChatbotFlowRuntimeContext,
        outputKey: string,
        lookupOutput: typeof output
      ) => {
        context = {
          ...current,
          lookups: { ...(current.lookups ?? {}), [outputKey]: lookupOutput },
        };
        return context;
      }
    ),
    persistTransition: jest.fn(async () => undefined),
  };
  const lookupService = { lookup: jest.fn(async () => output) };
  const dependencies = Array.from({ length: 27 }, () => ({}));
  dependencies[24] = runtimeContextService;
  dependencies[26] = lookupService;
  const runner = Reflect.construct(
    ChatbotFlowRunnerService,
    dependencies
  ) as unknown as UnderchatRunnerHarness;
  runner.processNextNode = jest.fn(async () => true);
  runner.buildApiRuntimeVariableScope = jest.fn(async () => ({
    data_1: { email: 'user@example.com' },
  }));

  return { runner, runtimeContextService, lookupService, output };
};

const chat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'Acme' },
  worker: { id: 'worker-1', name: 'WhatsApp' },
  contact: null,
} as unknown as IChat;

const underchatNode = {
  id: 'underchat-node',
  type: 'underchat',
  position: { x: 0, y: 0 },
  data: {
    outputKey: 'underchat_1',
    underchatLookup: {
      version: 1,
      lookupType: 'email',
      lookupExpression: '{{ data_1.email }}',
    },
  },
} as ListChatbotFlowResponse['nodes'][number];

const flow: ListChatbotFlowResponse = {
  chatbot_flow_id: 'flow-1',
  chatbot_id: 'chatbot-1',
  account_id: 'account-1',
  nodes: [
    underchatNode,
    { id: 'found-node', type: 'message', position: { x: 1, y: 0 }, data: {} },
    {
      id: 'not-found-node',
      type: 'message',
      position: { x: 1, y: 1 },
      data: {},
    },
  ],
  edges: [
    {
      id: 'found-edge',
      source: 'underchat-node',
      target: 'found-node',
      sourceHandle: 'found',
    },
    {
      id: 'not-found-edge',
      source: 'underchat-node',
      target: 'not-found-node',
      sourceHandle: 'not_found',
    },
  ],
};

describe('ChatbotFlowRunnerService Underchat node', () => {
  it.each([
    { found: true, expectedTarget: 'found-node' },
    { found: false, expectedTarget: 'not-found-node' },
  ])(
    'persists the lookup and follows the matching outcome when found=$found',
    async ({ found, expectedTarget }) => {
      const { runner, runtimeContextService, lookupService, output } =
        createHarness(found);

      await expect(
        runner.processUnderchatNode({} as never, chat, flow, underchatNode)
      ).resolves.toBe(true);

      expect(lookupService.lookup).toHaveBeenCalledWith({
        lookupType: 'email',
        value: 'user@example.com',
      });
      expect(runtimeContextService.withLookup).toHaveBeenCalledWith(
        expect.any(Object),
        'underchat_1',
        output
      );
      expect(runtimeContextService.persistTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'account-1',
          workerId: 'worker-1',
          chatId: 'chat-1',
          nextNodeId: expectedTarget,
        })
      );
      expect(runner.processNextNode).toHaveBeenCalledWith(
        expect.anything(),
        chat,
        flow,
        expectedTarget,
        undefined,
        undefined
      );
    }
  );

  it('does not scope the lookup to the chatbot owner or caller account', async () => {
    const { runner, lookupService } = createHarness(true);
    const ownerScopedFlow = { ...flow, account_id: 'chatbot-owner-account' };

    await runner.processUnderchatNode(
      {} as never,
      chat,
      ownerScopedFlow,
      underchatNode
    );

    expect(lookupService.lookup).toHaveBeenCalledWith({
      lookupType: 'email',
      value: 'user@example.com',
    });
  });

  it('rejects a non-text expression without querying or taking either branch', async () => {
    const { runner, lookupService, runtimeContextService } =
      createHarness(true);
    runner.buildApiRuntimeVariableScope.mockResolvedValueOnce({
      data_1: { email: { nested: true } },
    });

    await expect(
      runner.processUnderchatNode({} as never, chat, flow, underchatNode)
    ).rejects.toThrow('must resolve to text');
    expect(lookupService.lookup).not.toHaveBeenCalled();
    expect(runtimeContextService.persistTransition).not.toHaveBeenCalled();
  });

  it('interrupts execution when the configured variable does not exist', async () => {
    const { runner, lookupService, runtimeContextService } =
      createHarness(true);
    runner.buildApiRuntimeVariableScope.mockResolvedValueOnce({});

    await expect(
      runner.processUnderchatNode({} as never, chat, flow, underchatNode)
    ).rejects.toThrow('is not available in this flow context');
    expect(lookupService.lookup).not.toHaveBeenCalled();
    expect(runtimeContextService.persistTransition).not.toHaveBeenCalled();
  });

  it('does not follow not_found when the lookup fails technically', async () => {
    const { runner, lookupService, runtimeContextService } =
      createHarness(true);
    lookupService.lookup.mockRejectedValueOnce(
      new Error('database temporarily unavailable')
    );

    await expect(
      runner.processUnderchatNode({} as never, chat, flow, underchatNode)
    ).rejects.toThrow('database temporarily unavailable');
    expect(runtimeContextService.withLookup).not.toHaveBeenCalled();
    expect(runtimeContextService.persistTransition).not.toHaveBeenCalled();
    expect(runner.processNextNode).not.toHaveBeenCalled();
  });
});
