import { assignStableChatbotNodeOutputKeys } from '@core/common/functions/chatbotNodeOutputs';
import type { ChatbotFlowData } from '@core/schema/chatbot/chatbotFlow.schema';

const flow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'data-a',
      type: 'data',
      position: { x: 1, y: 0 },
      data: { dataType: 'email' },
    },
    {
      id: 'message-a',
      type: 'message',
      position: { x: 2, y: 0 },
      data: { continueType: 'after_response' },
    },
    {
      id: 'message-automatic',
      type: 'message',
      position: { x: 3, y: 0 },
      data: { continueType: 'automatic', outputKey: 'message_9' },
    },
  ],
  edges: [],
});

describe('chatbot captured node output keys', () => {
  it('preserves every Data/Message key and reserves removed origins', () => {
    const previousInput = flow();
    previousInput.nodes.push({
      id: 'data-removed',
      type: 'data',
      position: { x: 4, y: 0 },
      data: { dataType: 'cpf' },
    });
    const previous = assignStableChatbotNodeOutputKeys(previousInput);
    const input = flow();
    input.nodes.push({
      id: 'data-b',
      type: 'data',
      position: { x: 5, y: 0 },
      data: { dataType: 'cpf' },
    });

    const assigned = assignStableChatbotNodeOutputKeys(input, previous);

    expect(
      assigned.nodes.find((node) => node.id === 'data-a')?.data.outputKey
    ).toBe('data_1');
    expect(
      assigned.nodes.find((node) => node.id === 'message-a')?.data.outputKey
    ).toBe('message_1');
    expect(
      assigned.nodes.find((node) => node.id === 'data-b')?.data.outputKey
    ).toBe('data_3');
    expect(
      assigned.nodes.find((node) => node.id === 'message-automatic')?.data
        .outputKey
    ).toBe('message_9');
  });
});
