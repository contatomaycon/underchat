import 'reflect-metadata';

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { MetaGraphApiError } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { ScheduleOfficialMessageService } from '@core/services/scheduleOfficialMessage.service';

const t = ((key: string) => key) as never;

function makeService(overrides?: {
  workerTypeId?: string;
  metaTemplates?: any[];
  metaError?: Error;
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
    listApprovedMessageTemplates: jest.fn(async () => {
      if (overrides?.metaError) {
        throw overrides.metaError;
      }

      return (
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
      );
    }),
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
  it('explains when Meta has revoked the official connection access', async () => {
    const { service } = makeService({
      metaError: new MetaGraphApiError({
        message: 'Unsupported get request',
        code: 100,
        error_subcode: 33,
      }),
    });

    await expect(
      service.listApprovedTemplatesForWorker({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
      })
    ).rejects.toThrow('whatsapp_official_connection_access_lost');
  });

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

  it('preserves named Meta parameters and normalizes numeric schedule values', async () => {
    const { service } = makeService({
      metaTemplates: [
        {
          id: 'tpl-named-1',
          name: 'payment_update',
          language: 'pt_BR',
          category: 'UTILITY',
          parameter_format: 'NAMED',
          components: [
            {
              type: 'BODY',
              text: 'O valor atualizado é {{amount}}.',
              example: {
                body_text_named_params: [
                  {
                    param_name: 'amount',
                    example: '42',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    await expect(
      service.validateTemplateForSchedule({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        officialTemplate: {
          name: 'payment_update',
          language: 'pt_BR',
          parameter_format: 'NAMED',
          variables: [
            {
              key: 'BODY:amount',
              component_type: 'BODY',
              index: 1,
              parameter_name: 'amount',
              value: 42,
            },
          ],
        },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'payment_update',
        language: 'pt_BR',
        status: 'APPROVED',
        parameter_format: 'NAMED',
        variables: [
          {
            key: 'BODY:amount',
            component_type: 'BODY',
            index: 1,
            parameter_name: 'amount',
            button_index: null,
            value: '42',
          },
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

  it('maps invalid scalar values to the public required-variables error', async () => {
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
              value: '   ',
            },
          ],
        },
      })
    ).rejects.toThrow('official_template_variables_required');
  });

  it('does not expose malformed Meta templates to scheduling', async () => {
    const { service } = makeService({
      metaTemplates: [
        {
          id: 'malformed-1',
          name: 'followup_comercial',
          language: 'pt_BR',
          category: 'UTILITY',
          parameter_format: 'NAMED',
          components: [
            {
              type: 'BODY',
              text: 'Olá {{Name}}',
            },
          ],
        },
      ],
    });
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service.validateTemplateForSchedule({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        officialTemplate: {
          name: 'followup_comercial',
          language: 'pt_BR',
          parameter_format: 'NAMED',
          variables: [
            {
              key: 'BODY:name',
              component_type: 'BODY',
              index: 1,
              parameter_name: 'name',
              value: 'Maycon',
            },
          ],
        },
      })
    ).rejects.toThrow('official_template_not_approved_or_not_found');

    warn.mockRestore();
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
        workerId: 'worker-1',
        chatbotId: 'chatbot-1',
      })
    ).rejects.toThrow('schedule_official_chatbot_start_template_required');
  });

  it('allows schedule chatbots that start with an official template node', async () => {
    const { service } = makeService({
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          {
            id: 'official-1',
            type: 'officialTemplate',
            data: {
              templateName: 'abertura',
              templateLanguage: 'pt_BR',
              templateVariables: [
                {
                  key: 'BODY:1',
                  component_type: 'BODY',
                  index: 1,
                  value: '{{ name }}',
                },
              ],
            },
          },
        ],
        edges: [{ source: 'start-1', target: 'official-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        chatbotId: 'chatbot-1',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects a canonical initial template whose required variables are empty', async () => {
    const { service } = makeService({
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          {
            id: 'official-1',
            type: 'officialTemplate',
            data: {
              templateName: 'abertura',
              templateLanguage: 'pt_BR',
              templateVariables: [],
            },
          },
        ],
        edges: [{ source: 'start-1', target: 'official-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        chatbotId: 'chatbot-1',
      })
    ).rejects.toThrow('official_template_variables_required');
  });

  it('validates legacy official template data nested under the official field', async () => {
    const { service } = makeService({
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          {
            id: 'official-1',
            type: 'officialTemplate',
            data: {
              official: {
                templateName: 'abertura',
                templateLanguage: 'pt_BR',
                templateVariables: [
                  {
                    key: 'BODY:1',
                    component_type: 'BODY',
                    index: 1,
                    value: '{{ name }}',
                  },
                ],
              },
            },
          },
        ],
        edges: [{ source: 'start-1', target: 'official-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        chatbotId: 'chatbot-1',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects invalid syntax in a historical initial template snapshot', async () => {
    const { service } = makeService({
      metaTemplates: [
        {
          id: 'tpl-1',
          name: 'abertura',
          language: 'pt_BR',
          category: 'MARKETING',
          components: [{ type: 'BODY', text: 'Olá' }],
        },
      ],
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          {
            id: 'official-1',
            type: 'officialTemplate',
            data: {
              templateName: 'abertura',
              templateLanguage: 'pt_BR',
              templateVariables: [],
              templateComponents: [
                {
                  type: 'BODY',
                  text: 'Olá {{Name}}',
                },
              ],
              templatePreview: {
                body: 'Olá {{Name}}',
              },
            },
          },
        ],
        edges: [{ source: 'start-1', target: 'official-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        chatbotId: 'chatbot-1',
      })
    ).rejects.toThrow('official_template_variables_required');
  });

  it('rejects an initial template that is no longer approved for the worker', async () => {
    const { service } = makeService({
      metaTemplates: [],
      chatbotFlow: {
        nodes: [
          { id: 'start-1', type: 'start' },
          {
            id: 'official-1',
            type: 'officialTemplate',
            data: {
              templateName: 'abertura',
              templateLanguage: 'pt_BR',
              templateVariables: [],
            },
          },
        ],
        edges: [{ source: 'start-1', target: 'official-1' }],
      },
    });

    await expect(
      service.assertOfficialScheduleChatbotStart({
        t,
        accountId: 'account-1',
        workerId: 'worker-1',
        chatbotId: 'chatbot-1',
      })
    ).rejects.toThrow('official_template_not_approved_or_not_found');
  });
});
