import {
  getUpstreamApiContracts,
  isChatbotNodeOutputAvailableAtNode,
  validateChatbotApiVariableDependencies,
} from '@core/common/functions/chatbotApiGraph';
import {
  assignStableChatbotNodeOutputKeys,
  getChatbotNodeOutputDefinition,
} from '@core/common/functions/chatbotNodeOutputs';
import type { ChatbotFlowData } from '@core/schema/chatbot/chatbotFlow.schema';

const underchatNode = (): ChatbotFlowData['nodes'][number] => ({
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
});

const branchedFlow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    underchatNode(),
    {
      id: 'found-a',
      type: 'message',
      position: { x: 2, y: 0 },
      data: { text: '{{ underchat_1.user.email }}' },
    },
    {
      id: 'found-b',
      type: 'message',
      position: { x: 2, y: 1 },
      data: { text: '{{ underchat_1.account.plan }}' },
    },
    {
      id: 'not-found',
      type: 'message',
      position: { x: 2, y: 2 },
      data: { text: 'Cadastro não localizado' },
    },
  ],
  edges: [
    { id: 'start-underchat', source: 'start', target: 'underchat' },
    {
      id: 'found-a-edge',
      source: 'underchat',
      target: 'found-a',
      sourceHandle: 'found',
    },
    {
      id: 'found-b-edge',
      source: 'underchat',
      target: 'found-b',
      sourceHandle: 'found',
    },
    {
      id: 'not-found-edge',
      source: 'underchat',
      target: 'not-found',
      sourceHandle: 'not_found',
    },
  ],
});

describe('Underchat branch-aware output graph', () => {
  it('keeps the persisted underchat_N key stable and prevents key reuse', () => {
    const previous: ChatbotFlowData = {
      chatbot_id: 'chatbot-1',
      nodes: [
        {
          ...underchatNode(),
          id: 'persisted-underchat',
          data: {
            ...underchatNode().data,
            outputKey: 'underchat_4',
          },
        },
      ],
      edges: [],
    };
    const persistedNode = previous.nodes[0];
    if (!persistedNode) throw new Error('missing persisted Underchat fixture');
    const next: ChatbotFlowData = {
      chatbot_id: 'chatbot-1',
      nodes: [
        {
          ...persistedNode,
          data: { ...persistedNode.data, outputKey: 'underchat_99' },
        },
        {
          ...underchatNode(),
          id: 'new-underchat',
          data: { ...underchatNode().data, outputKey: 'underchat_4' },
        },
      ],
      edges: [],
    };

    const assigned = assignStableChatbotNodeOutputKeys(next, previous);

    expect(
      assigned.nodes.find((node) => node.id === 'persisted-underchat')?.data
        .outputKey
    ).toBe('underchat_4');
    expect(
      assigned.nodes.find((node) => node.id === 'new-underchat')?.data.outputKey
    ).toBe('underchat_1');
  });

  it('declares the typed output on the found handle', () => {
    const definition = getChatbotNodeOutputDefinition(underchatNode());

    expect(definition).toEqual(
      expect.objectContaining({
        nodeType: 'underchat',
        outputKey: 'underchat_1',
        sourceHandle: 'found',
      })
    );
    expect(definition?.fields).toEqual(
      expect.arrayContaining([
        { path: 'user.email', type: 'string', nullable: true },
        { path: 'user.access_group', type: 'string', nullable: true },
        { path: 'user.sectors', type: 'array' },
        { path: 'account.id', type: 'string', nullable: true },
        { path: 'account.name', type: 'string', nullable: true },
        { path: 'account.last_paid_amount', type: 'string', nullable: true },
      ])
    );
    expect(definition?.fields).not.toContainEqual(
      expect.objectContaining({ path: 'found' })
    );
  });

  it('makes outputs available across every found fan-out edge', () => {
    const flow = branchedFlow();

    expect(
      isChatbotNodeOutputAvailableAtNode(flow, 'underchat', 'found-a', 'found')
    ).toBe(true);
    expect(
      isChatbotNodeOutputAvailableAtNode(flow, 'underchat', 'found-b', 'found')
    ).toBe(true);
    expect(validateChatbotApiVariableDependencies(flow)).toEqual([]);
    expect(getUpstreamApiContracts(flow, 'found-a')).toHaveProperty(
      'underchat_1'
    );
  });

  it('keeps the routing outcome internal instead of exposing found as a variable', () => {
    const flow = branchedFlow();
    const foundNode = flow.nodes.find((node) => node.id === 'found-a');
    if (foundNode) foundNode.data.text = '{{ underchat_1.found }}';

    expect(validateChatbotApiVariableDependencies(flow)).toContainEqual(
      expect.objectContaining({
        code: 'uncaptured_output_path',
        nodeId: 'found-a',
        sourceNodeId: 'underchat',
        path: 'underchat_1.found',
      })
    );
  });

  it('rejects output use on not_found or through a bypass path', () => {
    const notFoundFlow = branchedFlow();
    const notFoundNode = notFoundFlow.nodes.find(
      (node) => node.id === 'not-found'
    );
    if (notFoundNode) {
      notFoundNode.data.text = '{{ underchat_1.user.name }}';
    }

    expect(validateChatbotApiVariableDependencies(notFoundFlow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ambiguous_output_dependency',
          nodeId: 'not-found',
          sourceNodeId: 'underchat',
        }),
      ])
    );
    expect(
      getUpstreamApiContracts(notFoundFlow, 'not-found')
    ).not.toHaveProperty('underchat_1');

    const bypassedFlow = branchedFlow();
    bypassedFlow.edges.push({
      id: 'bypass-found-a',
      source: 'start',
      target: 'found-a',
    });
    expect(validateChatbotApiVariableDependencies(bypassedFlow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ambiguous_output_dependency',
          nodeId: 'found-a',
          sourceNodeId: 'underchat',
        }),
      ])
    );
  });

  it('removes the output guarantee after found and not_found merge', () => {
    const flow = branchedFlow();
    flow.nodes.push({
      id: 'merged',
      type: 'message',
      position: { x: 3, y: 1 },
      data: { text: '{{ underchat_1.account.status }}' },
    });
    flow.edges.push(
      { id: 'found-merge', source: 'found-a', target: 'merged' },
      { id: 'not-found-merge', source: 'not-found', target: 'merged' }
    );

    expect(
      isChatbotNodeOutputAvailableAtNode(flow, 'underchat', 'merged', 'found')
    ).toBe(false);
    expect(validateChatbotApiVariableDependencies(flow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ambiguous_output_dependency',
          nodeId: 'merged',
          sourceNodeId: 'underchat',
        }),
      ])
    );
    expect(getUpstreamApiContracts(flow, 'merged')).not.toHaveProperty(
      'underchat_1'
    );
  });
});
