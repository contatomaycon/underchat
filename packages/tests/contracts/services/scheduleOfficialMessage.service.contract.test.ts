import 'reflect-metadata';

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { ScheduleOfficialMessageService } from '@core/services/scheduleOfficialMessage.service';

const t = ((key: string) => key) as never;

function makeService(overrides?: {
  workerTypeId?: string;
  metaTemplates?: any[];
  chatbotFlow?: any;
}) {
  const workerService = {
    viewWorkerType: jest.fn(async () => ({
      worker_id: 'worker-1',
      worker_type_id: overrides?.workerTypeId ?? EWorkerType.whatsapp,
    })),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn(() => 'plain-token'),
  };
  const metaWhatsappEmbeddedService = {
    listApprovedMessageTemplates: jest.fn(
      async () =>
        overrides?.metaTemplates ?? [
          {
            id: 'tpl-1',
            name: 'abertura',
            language: 'pt_BR',
            category: 'MARKETING',
            components: [
              {
                type: 'BODY',
                text: 'Olá {{1}}',
                example: {
                  body_text: [['Maycon']],
                },
              },
            ],
          },
        ]
    ),
  };
  const workerWhatsappOfficialConnectionRepository = {
    findActiveByWorkerId: jest.fn(async () => ({
      worker_id: 'worker-1',
      waba_id: 'waba-1',
      access_token_encrypted: 'encrypted-token',
      api_version: 'v24.0',
    })),
  };
  const chatbotService = {
    findChatbotFlowByChatbotId: jest.fn(async () => overrides?.chatbotFlow),
  };

  const service = new ScheduleOfficialMessageService(
    workerService as never,
    passwordEncryptorService as never,
    metaWhatsappEmbeddedService as never,
    new OfficialWhatsappTemplateService(),
    workerWhatsappOfficialConnectionRepository as never,
    chatbotService as never
  );

  return {
    service,
    workerService,
    metaWhatsappEmbeddedService,
    workerWhatsappOfficialConnectionRepository,
    chatbotService,
  };
}

describe('ScheduleOfficialMessageService', () => {
  it('validates an approved template and returns the normalized snapshot', async () => {
    const { service } = makeService();

    await expect(
      service.validateTemplateForSchedule({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        officialTemplate: {
          name: 'abertura',
          language: 'pt_BR',
          variables: [
            {
              key: 'BODY:1',
              component_type: 'BODY',
              index: 1,
              value: '{{ name }}',
            },
          ],
        },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'abertura',
        language: 'pt_BR',
        status: 'APPROVED',
        variables: [
          expect.objectContaining({
            key: 'BODY:1',
            value: '{{ name }}',
          }),
        ],
      })
    );
  });

  it('rejects missing required official template variables', async () => {
    const { service } = makeService();

    await expect(
      service.validateTemplateForSchedule({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        officialTemplate: {
          name: 'abertura',
          language: 'pt_BR',
          variables: [],
        },
      })
    ).rejects.toThrow('official_template_variables_required');
  });

  it('rejects schedule chatbots that do not start with an official template node', async () => {
    const { service } = makeService({
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          { id: 'text-1', type: 'message' },
        ],
        edges: [{ source: 'start-1', target: 'text-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        chatbotId: 'chatbot-1',
      })
    ).rejects.toThrow('schedule_official_chatbot_start_template_required');
  });

  it('allows schedule chatbots that start with an official template node', async () => {
    const { service } = makeService({
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          { id: 'official-1', type: 'officialTemplate' },
        ],
        edges: [{ source: 'start-1', target: 'official-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        chatbotId: 'chatbot-1',
      })
    ).resolves.toBeUndefined();
  });
});
