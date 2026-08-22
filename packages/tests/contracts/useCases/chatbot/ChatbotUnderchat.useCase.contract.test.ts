import 'reflect-metadata';

import { Value } from '@sinclair/typebox/value';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import {
  chatbotFlowDataSchema,
  type ChatbotFlowData,
} from '@core/schema/chatbot/chatbotFlow.schema';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { ChatbotClonerUseCase } from '@core/useCases/chatbot/ChatbotCloner.useCase';
import { ChatbotFlowListerUseCase } from '@core/useCases/chatbot/ChatbotFlowLister.useCase';
import { ChatbotFlowSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowSaver.useCase';

const t = ((key: string) => key) as never;

const fullAccessActions: IJwtGroupHierarchy[] = [
  {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Administrator',
    module_name: 'manager',
    action_name: EGeneralPermissions.full_access,
  },
];

const fullAccessGroupActions: IJwtGroupHierarchy[] = [
  {
    ...fullAccessActions[0],
    action_name: EGeneralPermissions.full_access_group,
  },
];

const underchatFlow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'underchat',
      type: 'underchat',
      position: { x: 1, y: 0 },
      data: {
        outputKey: 'underchat_1',
        underchatLookup: {
          version: 1,
          lookupType: 'email',
          lookupExpression: '{{ email }}',
        },
      },
    },
    { id: 'found', type: 'finish', position: { x: 2, y: 0 }, data: {} },
    {
      id: 'not-found',
      type: 'finish',
      position: { x: 2, y: 1 },
      data: {},
    },
  ],
  edges: [
    { id: 'start-underchat', source: 'start', target: 'underchat' },
    {
      id: 'underchat-found',
      source: 'underchat',
      target: 'found',
      sourceHandle: 'found',
    },
    {
      id: 'underchat-not-found',
      source: 'underchat',
      target: 'not-found',
      sourceHandle: 'not_found',
    },
  ],
});

const storedUnderchatFlow = (): ListChatbotFlowResponse => ({
  chatbot_flow_id: 'flow-1',
  account_id: 'account-1',
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z',
  ...underchatFlow(),
});

const createSaver = (chatbotService: Record<string, unknown>) =>
  new ChatbotFlowSaverUseCase(
    chatbotService as never,
    { existsAccountById: jest.fn(async () => true) } as never,
    {} as never,
    {} as never
  );

describe('Underchat stored flow contract', () => {
  it('requires a versioned lookup and stores it as an opaque mapping', () => {
    expect(Value.Check(chatbotFlowDataSchema, underchatFlow())).toBe(true);

    const invalid = underchatFlow();
    const underchat = invalid.nodes.find((node) => node.id === 'underchat');
    const invalidLookup = underchat?.data.underchatLookup as
      { version?: 1 } | undefined;
    if (invalidLookup) {
      delete invalidLookup.version;
    }
    expect(Value.Check(chatbotFlowDataSchema, invalid)).toBe(false);

    const mapping = chatbotFlowMappings() as any;
    expect(
      mapping.mappings.properties.nodes.properties.data.properties
        .underchatLookup
    ).toEqual({ type: 'object', enabled: false });
  });
});

describe('ChatbotFlowSaver Underchat contract', () => {
  it('accepts versioned configuration and exactly the found/not_found handles', async () => {
    const saver = createSaver({
      hasOfficialOnlineChannel: jest.fn(),
      hasNonOfficialLinkedChannel: jest.fn(),
    });

    await expect(
      saver.validate(
        t,
        underchatFlow(),
        { request: underchatFlow() },
        'account-1'
      )
    ).resolves.toBeUndefined();
  });

  it('rejects invalid configuration or outgoing handle names', async () => {
    const saver = createSaver({
      hasOfficialOnlineChannel: jest.fn(),
      hasNonOfficialLinkedChannel: jest.fn(),
    });
    const invalidConfiguration = underchatFlow();
    const underchat = invalidConfiguration.nodes.find(
      (node) => node.id === 'underchat'
    );
    if (underchat?.data.underchatLookup) {
      underchat.data.underchatLookup.lookupExpression = '';
    }

    await expect(
      saver.validate(
        t,
        invalidConfiguration,
        { request: invalidConfiguration },
        'account-1'
      )
    ).rejects.toThrow(
      'chatbot_flow_validation_underchat_configuration_required'
    );

    const invalidHandles = underchatFlow();
    const notFoundEdge = invalidHandles.edges.find(
      (edge) => edge.id === 'underchat-not-found'
    );
    if (notFoundEdge) notFoundEdge.sourceHandle = 'failure';

    await expect(
      saver.validate(
        t,
        invalidHandles,
        { request: invalidHandles },
        'account-1'
      )
    ).rejects.toThrow('chatbot_flow_validation_underchat_branches_required');

    const duplicatedHandle = underchatFlow();
    duplicatedHandle.edges.push({
      id: 'underchat-found-duplicate',
      source: 'underchat',
      target: 'found',
      sourceHandle: 'found',
    });
    await expect(
      saver.validate(
        t,
        duplicatedHandle,
        { request: duplicatedHandle },
        'account-1'
      )
    ).rejects.toThrow('chatbot_flow_validation_underchat_branches_required');
  });

  it('rejects a manually submitted output reference outside found', async () => {
    const saver = createSaver({
      hasOfficialOnlineChannel: jest.fn(),
      hasNonOfficialLinkedChannel: jest.fn(),
    });
    const flow = underchatFlow();
    const notFound = flow.nodes.find((node) => node.id === 'not-found');
    if (notFound) notFound.data.text = '{{ underchat_1.user.email }}';

    await expect(
      saver.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_api_variable_dependency');
  });

  it('blocks add and removal attempts without full access', async () => {
    const saveChatbotFlow = jest.fn(async () => 'saved-flow');
    const saverForAdd = createSaver({
      findChatbotFlowByChatbotId: jest.fn(async () => null),
      saveChatbotFlow,
    });

    await expect(
      saverForAdd.execute(
        t,
        { request: JSON.stringify(underchatFlow()) },
        'account-1',
        []
      )
    ).rejects.toMatchObject({
      name: 'ChatbotUnderchatAccessError',
      httpStatusCode: 403,
    });

    const findPersistedFlow = jest.fn(async () => storedUnderchatFlow());
    const saverForRemoval = createSaver({
      findChatbotFlowByChatbotId: findPersistedFlow,
      saveChatbotFlow,
    });
    const replacement: ChatbotFlowData = {
      chatbot_id: 'chatbot-1',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'finish', type: 'finish', position: { x: 1, y: 0 }, data: {} },
      ],
      edges: [{ id: 'edge', source: 'start', target: 'finish' }],
    };

    await expect(
      saverForRemoval.execute(
        t,
        { request: JSON.stringify(replacement) },
        'account-1',
        []
      )
    ).rejects.toMatchObject({ httpStatusCode: 403 });
    expect(findPersistedFlow).toHaveBeenCalledWith('account-1', 'chatbot-1', {
      includeInactive: true,
    });
    expect(saveChatbotFlow).not.toHaveBeenCalled();
  });

  it('allows a full-access save containing Underchat', async () => {
    const saveChatbotFlow = jest.fn(async () => 'saved-flow');
    const saver = createSaver({
      findChatbotFlowByChatbotId: jest.fn(async () => null),
      saveChatbotFlow,
    });
    jest.spyOn(saver, 'validate').mockResolvedValue(undefined);

    await expect(
      saver.execute(
        t,
        { request: JSON.stringify(underchatFlow()) },
        'account-1',
        fullAccessActions
      )
    ).resolves.toBe('saved-flow');
    expect(saveChatbotFlow).toHaveBeenCalledTimes(1);
  });
});

describe('ChatbotFlowLister Underchat contract', () => {
  it('returns a restricted read-only node without lookup details to non-full users', async () => {
    const lister = new ChatbotFlowListerUseCase({
      findChatbotFlowByChatbotId: jest.fn(async () => storedUnderchatFlow()),
    } as never);

    const listed = await lister.execute('account-1', 'chatbot-1', []);
    const underchat = listed?.nodes.find((node) => node.type === 'underchat');

    expect(listed).toEqual(
      expect.objectContaining({ read_only: true, restricted: true })
    );
    expect(underchat?.data.restricted).toBe(true);
    expect(underchat?.data.underchatLookup).toBeUndefined();
    expect(underchat?.data.outputKey).toBeUndefined();
  });

  it('returns the complete editable configuration to full-access users', async () => {
    const lister = new ChatbotFlowListerUseCase({
      findChatbotFlowByChatbotId: jest.fn(async () => storedUnderchatFlow()),
    } as never);

    const listed = await lister.execute(
      'account-1',
      'chatbot-1',
      fullAccessActions
    );
    const underchat = listed?.nodes.find((node) => node.type === 'underchat');

    expect(listed?.read_only).toBeUndefined();
    expect(listed?.restricted).toBeUndefined();
    expect(underchat?.data.restricted).toBeUndefined();
    expect(underchat?.data.underchatLookup).toEqual(
      expect.objectContaining({ version: 1, lookupType: 'email' })
    );
  });

  it('accepts the full-access group marker as full access', async () => {
    const lister = new ChatbotFlowListerUseCase({
      findChatbotFlowByChatbotId: jest.fn(async () => storedUnderchatFlow()),
    } as never);

    const listed = await lister.execute(
      'account-1',
      'chatbot-1',
      fullAccessGroupActions
    );

    expect(listed?.read_only).toBeUndefined();
    expect(
      listed?.nodes.find((node) => node.type === 'underchat')?.data
        .underchatLookup
    ).toBeDefined();
  });
});

describe('ChatbotCloner Underchat access contract', () => {
  const createCloner = (cloneChatbot: jest.Mock) =>
    new ChatbotClonerUseCase(
      {
        findChatbotById: jest.fn(async () => ({ chatbot_id: 'chatbot-1' })),
        cloneChatbot,
      } as never,
      {
        existsChatbotByName: jest.fn(async () => false),
        findChatbotFlowByChatbotId: jest.fn(async () => storedUnderchatFlow()),
        findChatbotFlowConfigurationsByChatbotId: jest.fn(async () => null),
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      { validateCanCreateChatbot: jest.fn(async () => undefined) } as never,
      { indices: jest.fn(), updateWithOCC: jest.fn() } as never
    );

  it('blocks cloning before creating a chatbot for non-full users', async () => {
    const cloneChatbot = jest.fn();
    const cloner = createCloner(cloneChatbot);

    await expect(
      cloner.execute(
        t,
        { chatbot_id: 'chatbot-1', name: 'Clone' },
        'account-1',
        []
      )
    ).rejects.toMatchObject({ httpStatusCode: 403 });
    expect(cloneChatbot).not.toHaveBeenCalled();
  });

  it('allows cloning a protected flow with full access', async () => {
    const cloneResponse = {
      chatbot_id: 'chatbot-clone',
      name: 'Clone',
      account_id: 'account-1',
      created_at: '2026-07-13T13:00:00.000Z',
      updated_at: '2026-07-13T13:00:00.000Z',
    };
    const cloneChatbot = jest.fn(async () => cloneResponse);
    const cloner = createCloner(cloneChatbot);

    await expect(
      cloner.execute(
        t,
        { chatbot_id: 'chatbot-1', name: 'Clone' },
        'account-1',
        fullAccessActions
      )
    ).resolves.toEqual(cloneResponse);
    expect(cloneChatbot).toHaveBeenCalledTimes(1);
  });
});
