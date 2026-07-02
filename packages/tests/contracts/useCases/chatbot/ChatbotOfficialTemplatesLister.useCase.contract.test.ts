import 'reflect-metadata';

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import type { MetaWhatsappApprovedTemplate } from '@core/services/metaWhatsappEmbedded.service';
import { ChatbotOfficialTemplatesListerUseCase } from '@core/useCases/chatbot/ChatbotOfficialTemplatesLister.useCase';

const makeMetaTemplate = (
  name: string,
  language = 'pt_BR'
): MetaWhatsappApprovedTemplate => ({
  id: `${name}-${language}`,
  name,
  language,
  status: 'APPROVED',
  category: 'MARKETING',
  components: [
    {
      type: 'BODY',
      text: `${name} {{1}}`,
      example: {
        body_text: [['Cliente']],
      },
    },
  ],
});

const makeUseCase = (input: {
  linkedWorkerIds?: string[];
  channels?: Array<{
    id: string;
    type_id?: string | null;
    is_official?: boolean;
  }>;
  templatesByWorker?: Record<string, MetaWhatsappApprovedTemplate[]>;
}) => {
  const chatbotService = {
    listChatbotChannels: jest.fn(async () => input.channels ?? []),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => `decrypted-${value}`),
  };
  const metaWhatsappEmbeddedService = {
    listApprovedMessageTemplates: jest.fn(
      async ({ wabaId }: { wabaId: string }) => {
        return input.templatesByWorker?.[wabaId] ?? [];
      }
    ),
  };
  const workerWhatsappOfficialConnectionRepository = {
    findActiveByWorkerId: jest.fn(async (workerId: string) => ({
      access_token_encrypted: `token-${workerId}`,
      api_version: 'v20.0',
      waba_id: workerId,
    })),
  };
  const chatbotOfficialCompatibilityRepository = {
    listActiveLinkedOfficialWorkerIds: jest.fn(
      async () => input.linkedWorkerIds ?? []
    ),
  };

  const useCase = new ChatbotOfficialTemplatesListerUseCase(
    chatbotService as never,
    passwordEncryptorService as never,
    metaWhatsappEmbeddedService as never,
    new OfficialWhatsappTemplateService(),
    workerWhatsappOfficialConnectionRepository as never,
    chatbotOfficialCompatibilityRepository as never
  );

  return {
    useCase,
    chatbotService,
    metaWhatsappEmbeddedService,
    workerWhatsappOfficialConnectionRepository,
    chatbotOfficialCompatibilityRepository,
  };
};

describe('ChatbotOfficialTemplatesListerUseCase', () => {
  it('lists approved templates from one linked official channel', async () => {
    const { useCase, chatbotService } = makeUseCase({
      linkedWorkerIds: ['worker-1'],
      templatesByWorker: {
        'worker-1': [makeMetaTemplate('abertura')],
      },
    });

    const templates = await useCase.execute('account-1', 'chatbot-1', [
      { id: 'worker-1', name: 'Oficial' },
    ]);

    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      name: 'abertura',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'MARKETING',
    });
    expect(chatbotService.listChatbotChannels).not.toHaveBeenCalled();
  });

  it('returns only templates common to multiple linked official channels by name and language', async () => {
    const { useCase } = makeUseCase({
      linkedWorkerIds: ['worker-1', 'worker-2'],
      templatesByWorker: {
        'worker-1': [
          makeMetaTemplate('abertura', 'pt_BR'),
          makeMetaTemplate('abertura', 'en'),
          makeMetaTemplate('somente_primeiro', 'pt_BR'),
        ],
        'worker-2': [
          makeMetaTemplate('abertura', 'pt_BR'),
          makeMetaTemplate('somente_segundo', 'pt_BR'),
        ],
      },
    });

    const templates = await useCase.execute('account-1', 'chatbot-1');

    expect(
      templates.map((template) => `${template.name}::${template.language}`)
    ).toEqual(['abertura::pt_BR']);
  });

  it('falls back to official channels accessible to the user when no channel is linked yet', async () => {
    const { useCase, workerWhatsappOfficialConnectionRepository } = makeUseCase(
      {
        linkedWorkerIds: [],
        channels: [
          {
            id: 'worker-official',
            type_id: EWorkerType.whatsapp,
            is_official: true,
          },
          {
            id: 'worker-non-official',
            type_id: 'non-official',
            is_official: false,
          },
        ],
        templatesByWorker: {
          'worker-official': [makeMetaTemplate('abertura')],
          'worker-non-official': [makeMetaTemplate('nao_deve_aparecer')],
        },
      }
    );

    const templates = await useCase.execute('account-1', 'chatbot-1');

    expect(templates.map((template) => template.name)).toEqual(['abertura']);
    expect(
      workerWhatsappOfficialConnectionRepository.findActiveByWorkerId
    ).toHaveBeenCalledTimes(1);
    expect(
      workerWhatsappOfficialConnectionRepository.findActiveByWorkerId
    ).toHaveBeenCalledWith('worker-official');
  });

  it('returns an empty list when there is no approved template', async () => {
    const { useCase } = makeUseCase({
      linkedWorkerIds: ['worker-1'],
      templatesByWorker: {
        'worker-1': [],
      },
    });

    await expect(useCase.execute('account-1', 'chatbot-1')).resolves.toEqual(
      []
    );
  });
});
