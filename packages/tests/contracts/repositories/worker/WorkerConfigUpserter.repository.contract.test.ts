import 'reflect-metadata';
import { WorkerConfigUpserterRepository } from '@core/repositories/worker/WorkerConfigUpserter.repository';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

function buildRepository() {
  const dbRw = {
    transaction: jest.fn(async (callback) => callback({ tx: true })),
  };
  const dbRo = {};

  return {
    repository: new WorkerConfigUpserterRepository(
      dbRw as never,
      dbRo as never
    ),
    dbRw,
  };
}

describe('WorkerConfigUpserterRepository', () => {
  it('upsertWorkerConfig routes boolean and proxy inputs to helper methods', async () => {
    const { repository, dbRw } = buildRepository();
    (repository as any).upsertBooleanConfig = jest.fn(async () => undefined);
    (repository as any).upsertProxyConfig = jest.fn(async () => undefined);

    await expect(
      repository.upsertWorkerConfig('w-1', {
        show_attendee_name: true,
        show_worker_name: false,
        proxy_enabled: true,
      } as never)
    ).resolves.toBeUndefined();

    expect(dbRw.transaction).toHaveBeenCalledTimes(1);
    expect((repository as any).upsertBooleanConfig).toHaveBeenCalledTimes(2);
    expect((repository as any).upsertProxyConfig).toHaveBeenCalledTimes(1);
  });

  it('updateTransfer protocol methods call upsertConfigValue and return stored values', async () => {
    const { repository } = buildRepository();
    (repository as any).upsertConfigValue = jest.fn(async () => undefined);
    (repository as any).getConfigValue = jest
      .fn()
      .mockResolvedValueOnce('transfer')
      .mockResolvedValueOnce('sector')
      .mockResolvedValueOnce('sector-user')
      .mockResolvedValueOnce('start');

    await expect(
      repository.updateTransferProtocolText('w-1', 'transfer', 'active')
    ).resolves.toBe('transfer');
    await expect(
      repository.updateTransferProtocolSectorText('w-1', 'sector', 'active')
    ).resolves.toBe('sector');
    await expect(
      repository.updateTransferProtocolSectorAndUserText(
        'w-1',
        'sector-user',
        'active'
      )
    ).resolves.toBe('sector-user');
    await expect(
      repository.updateStartProtocolText('w-1', 'start', 'active')
    ).resolves.toBe('start');
  });

  it('updateSimultaneousAttendance parses persisted value', async () => {
    const { repository } = buildRepository();
    (repository as any).upsertConfigValue = jest.fn(async () => undefined);
    (repository as any).getConfigValue = jest
      .fn()
      .mockResolvedValueOnce('7')
      .mockResolvedValueOnce(null);

    await expect(
      repository.updateSimultaneousAttendance('w-1', 7, 'active')
    ).resolves.toBe(7);
    await expect(
      repository.updateSimultaneousAttendance('w-1', null, 'active')
    ).resolves.toBeNull();
  });

  it('updateShowMessage and updateSendMessage return persisted values', async () => {
    const { repository } = buildRepository();
    (repository as any).upsertConfigValue = jest.fn(async () => undefined);
    (repository as any).getConfigValue = jest
      .fn()
      .mockResolvedValueOnce('on-call')
      .mockResolvedValueOnce('finish');

    await expect(
      repository.updateShowMessageOnCall('w-1', 'on-call', 'active')
    ).resolves.toBe('on-call');
    await expect(
      repository.updateSendMessageOnFinishAttendance('w-1', 'finish', 'active')
    ).resolves.toBe('finish');
  });

  it('updateAttendanceHours returns both persisted fields', async () => {
    const { repository } = buildRepository();
    (repository as any).upsertConfigValue = jest.fn(async () => undefined);
    (repository as any).getConfigValue = jest
      .fn()
      .mockResolvedValueOnce('hours-json')
      .mockResolvedValueOnce('outside-message');

    await expect(
      repository.updateAttendanceHours(
        'w-1',
        'hours-json',
        'outside-message',
        'active'
      )
    ).resolves.toEqual({
      attendance_hours: 'hours-json',
      outside_hours_message: 'outside-message',
    });
  });

  it('updateAttendanceInactivityAlert returns persisted value', async () => {
    const { repository } = buildRepository();
    (repository as any).upsertConfigValue = jest.fn(async () => undefined);
    (repository as any).getConfigValue = jest
      .fn()
      .mockResolvedValueOnce('inactivity-json');

    await expect(
      repository.updateAttendanceInactivityAlert(
        'w-1',
        'inactivity-json',
        'active'
      )
    ).resolves.toBe('inactivity-json');
  });

  it('updateChatbot updates existing config and returns chatbot id', async () => {
    const { repository } = buildRepository();
    (repository as any).findConfigByWorkerAndTypeId = jest.fn(async () => ({
      worker_config_id: 'cfg-1',
      worker_config_status_id: 'active',
    }));
    (repository as any).updateChatbotId = jest.fn(async () => undefined);
    (repository as any).createChatbotConfig = jest.fn(async () => undefined);
    (repository as any).getChatbotId = jest.fn(async () => 'chatbot-1');

    await expect(
      repository.updateChatbot('w-1', 'chatbot-1', EWorkerConfigStatus.active)
    ).resolves.toBe('chatbot-1');

    expect((repository as any).updateChatbotId).toHaveBeenCalledTimes(1);
    expect((repository as any).createChatbotConfig).not.toHaveBeenCalled();
  });

  it('updateAiAgent creates config when there is no existing row', async () => {
    const { repository } = buildRepository();
    (repository as any).findConfigByWorkerAndTypeId = jest.fn(async () => null);
    (repository as any).updateAiAgentId = jest.fn(async () => undefined);
    (repository as any).createAiAgentConfig = jest.fn(async () => undefined);
    (repository as any).getAiAgentId = jest.fn(async () => 'agent-1');

    await expect(
      repository.updateAiAgent('w-1', 'agent-1', EWorkerConfigStatus.active)
    ).resolves.toBe('agent-1');

    expect((repository as any).createAiAgentConfig).toHaveBeenCalledTimes(1);
    expect((repository as any).updateAiAgentId).not.toHaveBeenCalled();
  });

  it('updateChatbots orchestrates input/output chatbot and working hours', async () => {
    const { repository } = buildRepository();
    (repository as any).upsertInputChatbot = jest.fn(async () => undefined);
    (repository as any).upsertOutputChatbot = jest.fn(async () => undefined);
    (repository as any).upsertChatbotWorkingHoursEnabled = jest.fn(
      async () => undefined
    );
    (repository as any).replaceChatbotWorkingHoursRules = jest.fn(
      async () => undefined
    );
    (repository as any).getChatbotId = jest.fn(async () => 'chatbot-in');
    (repository as any).getChatbotIdByType = jest.fn(async () => 'chatbot-out');

    await expect(
      repository.updateChatbots(
        'w-1',
        'chatbot-in',
        'chatbot-out',
        EWorkerConfigStatus.inactive,
        {
          enabled: true,
          timezone: 'America/Sao_Paulo',
          rules: [],
        }
      )
    ).resolves.toEqual({
      chatbot_id: 'chatbot-in',
      output_chatbot_id: 'chatbot-out',
    });

    expect((repository as any).upsertOutputChatbot).toHaveBeenCalledWith(
      expect.anything(),
      'w-1',
      'chatbot-out',
      EWorkerConfigStatus.active
    );
  });

  it('updateTransfer/attendance methods pass expected config type ids', async () => {
    const { repository } = buildRepository();
    const upsertConfigValue = jest.fn(async () => undefined);
    (repository as any).upsertConfigValue = upsertConfigValue;
    (repository as any).getConfigValue = jest.fn(async () => null);

    await repository.updateTransferProtocolText('w-1', null, 'active');
    await repository.updateStartProtocolText('w-1', null, 'active');
    await repository.updateAttendanceHours('w-1', null, null, 'active');
    await repository.updateAttendanceInactivityAlert('w-1', null, 'active');

    expect(upsertConfigValue).toHaveBeenCalledWith(
      expect.anything(),
      'w-1',
      'active',
      EWorkerConfigType.generate_protocol_at_transfer,
      null
    );
    expect(upsertConfigValue).toHaveBeenCalledWith(
      expect.anything(),
      'w-1',
      'active',
      EWorkerConfigType.generate_protocol_at_start,
      null
    );
    expect(upsertConfigValue).toHaveBeenCalledWith(
      expect.anything(),
      'w-1',
      'active',
      EWorkerConfigType.attendance_inactivity_alert,
      null
    );
  });
});
