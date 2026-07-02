import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import type { IChat } from '@core/common/interfaces/IChat';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';

const makeService = () => {
  const contactService = {
    getContactByPhone: jest.fn(async () => null),
  };

  const dependencies = [
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    contactService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ] satisfies ConstructorParameters<typeof ChatbotFlowRunnerService>;

  return new ChatbotFlowRunnerService(...dependencies);
};

describe('ChatbotFlowRunnerService official list payload', () => {
  it('uses node options when internal sections data is empty', async () => {
    const service = makeService() as unknown as {
      buildOfficialInteractivePayload: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<Record<string, unknown> | null>;
    };

    const interactive = await service.buildOfficialInteractivePayload(
      (key) => key,
      {
        chat_id: 'chat-1',
        name: 'Maycon',
        account: { id: 'account-1', name: 'Underchat' },
        worker: { id: 'worker-1', name: 'Oficial WhatsApp' },
        user: null,
        sector: null,
      } as unknown as IChat,
      {
        id: 'node-1',
        type: 'officialList',
        position: { x: 0, y: 0 },
        data: {
          title: 'Lista oficial',
          message: 'Escolha uma opção',
          buttonText: 'Selecionar',
          sections: [],
          options: [
            {
              id: '1',
              text: 'Endereço e finalizar',
              description: 'Descrição da opção 1',
            },
            {
              id: '2',
              text: 'Linha',
              description: '',
            },
          ],
        },
      }
    );

    expect(interactive).toEqual(
      expect.objectContaining({
        type: 'list',
        action: {
          button: 'Selecionar',
          sections: [
            {
              title: 'Opções',
              rows: [
                {
                  id: '1',
                  title: 'Endereço e finalizar',
                  description: 'Descrição da opção 1',
                },
                {
                  id: '2',
                  title: 'Linha',
                },
              ],
            },
          ],
        },
      })
    );
  });
});
