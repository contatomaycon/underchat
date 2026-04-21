import 'reflect-metadata';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';

function createSelectMock(resultsQueue: unknown[][]) {
  const queue = [...resultsQueue];

  return jest.fn(() => {
    const result = queue.shift() ?? [];
    const chain: {
      innerJoin: jest.Mock;
      where: jest.Mock;
      limit: jest.Mock;
      orderBy: jest.Mock;
      execute: jest.Mock;
    } = {
      innerJoin: jest.fn(),
      where: jest.fn(),
      limit: jest.fn(),
      orderBy: jest.fn(),
      execute: jest.fn(async () => result),
    };
    chain.innerJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);

    return {
      from: jest.fn(() => chain),
    };
  });
}

describe('WorkerConfigViewerRepository', () => {
  it('viewWorkerConfigByWorkerId returns null when no config and no chatbot', async () => {
    const repository = new WorkerConfigViewerRepository({} as never);
    (repository as any).fetchActiveConfigs = jest.fn(async () => new Map());
    (repository as any).fetchChatbotId = jest.fn(async () => null);

    await expect(
      repository.viewWorkerConfigByWorkerId('w-1')
    ).resolves.toBeNull();
  });

  it('viewWorkerConfigByWorkerId builds config value payload', async () => {
    const repository = new WorkerConfigViewerRepository({} as never);
    (repository as any).fetchActiveConfigs = jest.fn(async () => {
      const map = new Map();
      map.set(EWorkerConfigType.show_worker_name, null);
      map.set(EWorkerConfigType.simultaneous_attendance, '2');
      map.set(EWorkerConfigType.proxy_protocol, EProxyProtocol.http);
      return map;
    });
    (repository as any).fetchChatbotId = jest.fn(async () => 'chatbot-1');

    const result = await repository.viewWorkerConfigByWorkerId('w-1');
    expect(result).toEqual(
      expect.objectContaining({
        worker_id: 'w-1',
        show_worker_name: true,
        simultaneous_attendance: 2,
        proxy_protocol: EProxyProtocol.http,
        chatbot_id: 'chatbot-1',
      })
    );
  });

  it('fetchChatbotValue and fetchAiAgentValue return ids and status', async () => {
    const repository = new WorkerConfigViewerRepository({
      select: createSelectMock([
        [{ chatbot_id: 'chatbot-1', worker_config_status_id: 'active' }],
        [{ ai_agent_id: 'agent-1', worker_config_status_id: 'inactive' }],
      ]),
    } as never);

    await expect(repository.fetchChatbotValue('w-1')).resolves.toEqual({
      chatbotId: 'chatbot-1',
      statusId: 'active',
    });
    await expect(repository.fetchAiAgentValue('w-1')).resolves.toEqual({
      aiAgentId: 'agent-1',
      statusId: 'inactive',
    });
  });

  it('fetchChatbotsValue parses working hours configs and filters invalid rules', async () => {
    const repository = new WorkerConfigViewerRepository({
      select: createSelectMock([
        [{ chatbot_id: 'chatbot-in', worker_config_status_id: 'active' }],
        [{ chatbot_id: 'chatbot-out', worker_config_status_id: 'inactive' }],
        [
          {
            value: JSON.stringify({ timezone: 'America/Sao_Paulo' }),
            worker_config_status_id: EWorkerConfigStatus.active,
          },
        ],
        [
          {
            chatbot_id: 'chatbot-in',
            value: JSON.stringify({
              weekday: 'monday',
              start_time: '08:00',
              end_time: '18:00',
            }),
          },
          { chatbot_id: 'chatbot-in', value: 'invalid-json' },
        ],
      ]),
    } as never);

    const result = await repository.fetchChatbotsValue('w-1');
    expect(result.inputChatbotId).toBe('chatbot-in');
    expect(result.outputChatbotId).toBe('chatbot-out');
    expect(result.chatbotWorkingHoursEnabled).toBe(true);
    expect(result.chatbotWorkingHoursRules).toHaveLength(1);
  });

  it('fetchSimultaneousAttendanceValue and config value helpers return fallback nulls', async () => {
    const repository = new WorkerConfigViewerRepository({
      select: createSelectMock([
        [{ value: '5', worker_config_status_id: 'active' }],
        [],
        [{ value: 'text', worker_config_status_id: 'active' }],
      ]),
    } as never);

    await expect(
      repository.fetchSimultaneousAttendanceValue('w-1')
    ).resolves.toEqual({ value: '5', statusId: 'active' });
    await expect(
      repository.fetchConfigValueByType('w-1', EWorkerConfigType.chatbot_id)
    ).resolves.toEqual({ value: null, statusId: null });
    await expect(
      repository.fetchConfigValueByAccountId(
        'a-1',
        EWorkerConfigType.chatbot_id
      )
    ).resolves.toEqual({ value: 'text', statusId: 'active' });
  });

  it('parse helpers handle invalid values', () => {
    const repository = new WorkerConfigViewerRepository({} as never);

    expect((repository as any).parseNumber('invalid')).toBeNull();
    expect((repository as any).parseProxyProtocol('invalid')).toBeNull();
  });
});
