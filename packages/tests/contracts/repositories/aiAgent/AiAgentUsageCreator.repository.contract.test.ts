import 'reflect-metadata';
import { AiAgentUsageCreatorRepository } from '@core/repositories/aiAgent/AiAgentUsageCreator.repository';

describe('AiAgentUsageCreatorRepository', () => {
  it('inserts usage payload with undefined fallback for nullable fields', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const dbRw = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new AiAgentUsageCreatorRepository(dbRw as never);

    await repository.create({
      ai_agent_id: 'agent-1',
      account_id: null,
      chat_id: null,
      prompt_tokens: null,
      completion_tokens: 12,
      total_tokens: 22,
      model: 'gpt-4o',
      latency_ms: null,
      success: true,
      request_type: null,
    });

    expect(values).toHaveBeenCalledWith({
      ai_agent_id: 'agent-1',
      account_id: undefined,
      chat_id: undefined,
      prompt_tokens: undefined,
      completion_tokens: 12,
      total_tokens: 22,
      model: 'gpt-4o',
      latency_ms: undefined,
      success: true,
      request_type: undefined,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
