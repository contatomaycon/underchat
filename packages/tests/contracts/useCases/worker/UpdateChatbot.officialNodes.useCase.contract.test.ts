import 'reflect-metadata';

import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { UpdateChatbotUseCase } from '@core/useCases/worker/UpdateChatbot.useCase';

const t = ((key: string) => key) as never;

const inputChatbotId = '11111111-1111-4111-8111-111111111111';
const outputChatbotId = '22222222-2222-4222-8222-222222222222';

const officialFlow = {
  chatbot_id: inputChatbotId,
  account_id: 'account-1',
  chatbot_flow_id: 'flow-1',
  nodes: [
    {
      id: 'official-1',
      type: 'officialReplyButtons',
      position: { x: 0, y: 0 },
      data: {},
    },
  ],
  edges: [],
};

const makeUseCase = (workerTypeId: EWorkerType) => {
  const workerConfigService = {
    viewChatbots: jest.fn(async () => ({
      chatbot_id: null,
      output_chatbot_id: null,
      chatbot_working_hours_enabled: false,
      chatbot_working_hours_timezone: 'America/Sao_Paulo',
      chatbot_working_hours_rules: [],
      enabled: false,
    })),
    updateChatbots: jest.fn(async () => ({
      chatbot_id: inputChatbotId,
      output_chatbot_id: outputChatbotId,
      chatbot_working_hours_enabled: false,
      chatbot_working_hours_timezone: 'America/Sao_Paulo',
      chatbot_working_hours_rules: [],
      enabled: true,
    })),
  };
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorkerType: jest.fn(async () => ({ worker_type_id: workerTypeId })),
  };
  const chatbotService = {
    listChatbots: jest.fn(async () => [
      {
        chatbot_id: inputChatbotId,
        name: 'Entrada',
        type: 'input',
        status: EChatbotStatus.active,
      },
      {
        chatbot_id: outputChatbotId,
        name: 'Saída',
        type: 'output',
        status: EChatbotStatus.active,
      },
    ]),
    findChatbotFlowByChatbotId: jest.fn(async () => officialFlow),
  };

  const useCase = new UpdateChatbotUseCase(
    workerConfigService as never,
    workerService as never,
    chatbotService as never
  );

  return { useCase, workerConfigService, chatbotService };
};

describe('UpdateChatbotUseCase official nodes', () => {
  it('rejects chatbot with official node in non-official channel', async () => {
    const { useCase, workerConfigService } = makeUseCase(EWorkerType.baileys);

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        chatbot_id: inputChatbotId,
        output_chatbot_id: outputChatbotId,
        enabled: true,
      })
    ).rejects.toThrow(
      'chatbot_official_nodes_not_allowed_on_non_official_channel'
    );

    expect(workerConfigService.updateChatbots).not.toHaveBeenCalled();
  });

  it('allows chatbot with official node in official channel', async () => {
    const { useCase, workerConfigService, chatbotService } = makeUseCase(
      EWorkerType.whatsapp
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        chatbot_id: inputChatbotId,
        output_chatbot_id: outputChatbotId,
        enabled: true,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        chatbot_id: inputChatbotId,
        output_chatbot_id: outputChatbotId,
        enabled: true,
      })
    );

    expect(chatbotService.findChatbotFlowByChatbotId).not.toHaveBeenCalled();
    expect(workerConfigService.updateChatbots).toHaveBeenCalled();
  });
});
