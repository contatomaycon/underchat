import 'reflect-metadata';

import type { TFunction } from 'i18next';

import { UpdateAiAgentConfigUseCase } from '@core/useCases/worker/UpdateAiAgentConfig.useCase';

const t = ((key: string) => key) as TFunction<'translation', undefined>;

describe('UpdateAiAgentConfigUseCase contracts', () => {
  it('can disable and detach an unavailable agent without validating it', async () => {
    const workerConfigService = {
      viewAiAgent: jest.fn(async () => ({
        ai_agent_id: '019d6086-9226-7398-970a-9e5fa57a3852',
        enabled: true,
      })),
      updateAiAgent: jest.fn(async () => ({
        ai_agent_id: null,
        enabled: false,
      })),
    };
    const workerService = {
      existsWorkerById: jest.fn(async () => true),
    };
    const aiAgentService = {
      viewAiAgent: jest.fn(),
    };
    const useCase = new UpdateAiAgentConfigUseCase(
      workerConfigService as never,
      workerService as never,
      aiAgentService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        ai_agent_id: null,
        enabled: false,
      })
    ).resolves.toEqual({
      ai_agent_id: null,
      enabled: false,
    });

    expect(aiAgentService.viewAiAgent).not.toHaveBeenCalled();
    expect(workerConfigService.updateAiAgent).toHaveBeenCalledWith(
      'worker-1',
      null,
      false
    );
  });

  it('rejects enabling AI without an agent selection', async () => {
    const workerConfigService = {
      viewAiAgent: jest.fn(async () => ({
        ai_agent_id: null,
        enabled: false,
      })),
      updateAiAgent: jest.fn(),
    };
    const useCase = new UpdateAiAgentConfigUseCase(
      workerConfigService as never,
      {
        existsWorkerById: jest.fn(async () => true),
      } as never,
      {
        viewAiAgent: jest.fn(),
      } as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        enabled: true,
      })
    ).rejects.toThrow('ai_agent_not_found');
    expect(workerConfigService.updateAiAgent).not.toHaveBeenCalled();
  });
});
