import 'reflect-metadata';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { WorkerConfigForChatViewerRepository } from '@core/repositories/chat/WorkerConfigForChatViewer.repository';

function createActiveConfigChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createLimitChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('WorkerConfigForChatViewerRepository', () => {
  it('returns null when there are no active configs', async () => {
    const activeChain = createActiveConfigChain([]);
    const chatbotOutputChain = createLimitChain([]);
    const aiAgentChain = createLimitChain([]);
    const operatorReplyPendingAlertChain = createLimitChain([]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(activeChain.select)
        .mockImplementationOnce(chatbotOutputChain.select)
        .mockImplementationOnce(aiAgentChain.select)
        .mockImplementationOnce(operatorReplyPendingAlertChain.select),
    };
    const repository = new WorkerConfigForChatViewerRepository(dbRo as never);

    await expect(
      repository.viewWorkerConfigForChatByWorkerId('worker-1')
    ).resolves.toBeNull();
  });

  it('builds chat config using active flags, chatbot output and AI agent config', async () => {
    const activeChain = createActiveConfigChain([
      {
        worker_config_type_id: EWorkerConfigType.show_worker_name,
        value: null,
      },
      {
        worker_config_type_id: EWorkerConfigType.simultaneous_attendance,
        value: '3',
      },
      {
        worker_config_type_id: EWorkerConfigType.generate_protocol_at_transfer,
        value: null,
      },
    ]);
    const chatbotOutputChain = createLimitChain([
      {
        chatbot_id: 'chatbot-1',
        worker_config_status_id: EWorkerConfigStatus.active,
      },
    ]);
    const aiAgentChain = createLimitChain([
      {
        ai_agent_id: 'agent-1',
        worker_config_status_id: EWorkerConfigStatus.active,
      },
    ]);
    const operatorReplyPendingAlertChain = createLimitChain([]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(activeChain.select)
        .mockImplementationOnce(chatbotOutputChain.select)
        .mockImplementationOnce(aiAgentChain.select)
        .mockImplementationOnce(operatorReplyPendingAlertChain.select),
    };
    const repository = new WorkerConfigForChatViewerRepository(dbRo as never);

    await expect(
      repository.viewWorkerConfigForChatByWorkerId('worker-1')
    ).resolves.toEqual({
      show_worker_name: true,
      show_attendee_name: false,
      show_protocol_in_chat: false,
      send_message_on_finish_attendance_enabled: false,
      send_message_on_transfer_enabled: true,
      allow_attendance_only_online: false,
      simultaneous_attendance: 3,
      simultaneous_attendance_enabled: true,
      attendance_inactivity_alert_enabled: false,
      operator_reply_pending_alert_enabled: false,
      operator_reply_pending_alert_time_minutes: 15,
      has_ura_output: true,
      ai_agent_enabled: true,
      ai_agent_id: 'agent-1',
    });
  });
});
