import { buildQuotedTextFromExtended } from '@core/common/functions/buildQuotedTextFromExtended';
import { EMessageType } from '@core/common/enums/EMessageType';

describe('buildQuotedTextFromExtended', () => {
  it('normalizes phone_partial for quoted contact cards without throwing', () => {
    const quoted = buildQuotedTextFromExtended({
      key: {
        remoteJid: '554788483267@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        extendedTextMessage: {
          text: 'reply',
          contextInfo: {
            stanzaId: 'quoted-message-id',
            participant: '5511999999999@s.whatsapp.net',
            quotedMessage: {
              contactMessage: {
                displayName: 'Maria Silva',
                vcard: [
                  'BEGIN:VCARD',
                  'VERSION:3.0',
                  'FN:Maria Silva',
                  'TEL:+55 (47) 8848-3267',
                  'EMAIL:maria@example.com',
                  'END:VCARD',
                ].join('\n'),
              },
            },
          },
        },
      },
    } as never);

    expect(quoted).toMatchObject({
      type: EMessageType.contact_card,
      message: 'Maria Silva',
      contact: {
        name: 'Maria',
        last_name: 'Silva',
        phone: '+55 (47) 8848-3267',
        phone_partial: '554788483267',
        email: 'maria@example.com',
      },
    });
  });

  it('preserves quoted button metadata for button reply rendering', () => {
    const quoted = buildQuotedTextFromExtended({
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        buttonsResponseMessage: {
          selectedDisplayText: 'Atendimento',
          contextInfo: {
            stanzaId: 'quoted-buttons-id',
            participant: '5500000000000@s.whatsapp.net',
            quotedMessage: {
              buttonsMessage: {
                contentText: 'Escolha uma opção',
                headerType: 1,
                buttons: [
                  {
                    buttonId: '1',
                    buttonText: { displayText: 'Atendimento' },
                    type: 1,
                  },
                  {
                    buttonId: '2',
                    buttonText: { displayText: 'Financeiro' },
                    type: 1,
                  },
                ],
              },
            },
          },
        },
      },
    } as never);

    expect(quoted).toMatchObject({
      type: EMessageType.text,
      message: 'Escolha uma opção',
      buttons: {
        text: 'Escolha uma opção',
        header_type: 1,
        buttons: [
          {
            id: '1',
            display_text: 'Atendimento',
            type: 1,
          },
          {
            id: '2',
            display_text: 'Financeiro',
            type: 1,
          },
        ],
      },
    });
  });

  it('preserves quoted list metadata for list reply rendering', () => {
    const quoted = buildQuotedTextFromExtended({
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        listResponseMessage: {
          title: 'Opção 2',
          description: 'Localização e Atendimento',
          singleSelectReply: {
            selectedRowId: '2',
          },
          contextInfo: {
            stanzaId: 'quoted-list-id',
            participant: '5500000000000@s.whatsapp.net',
            quotedMessage: {
              listMessage: {
                description: 'Escolha uma opção',
                buttonText: 'Selecionar',
                listType: 1,
                sections: [
                  {
                    rows: [
                      {
                        rowId: '1',
                        title: 'Endereço e finalizar',
                        description: 'Descrição da opção 1',
                      },
                      {
                        rowId: '2',
                        title: 'Opção 2',
                        description: 'Localização e Atendimento',
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    } as never);

    expect(quoted).toMatchObject({
      type: EMessageType.text,
      message: 'Escolha uma opção',
      list: {
        text: 'Escolha uma opção',
        button_text: 'Selecionar',
        list_type: 1,
        sections: [
          {
            id: 'section-1',
            title: null,
            rows: [
              {
                id: '1',
                title: 'Endereço e finalizar',
                description: 'Descrição da opção 1',
              },
              {
                id: '2',
                title: 'Opção 2',
                description: 'Localização e Atendimento',
              },
            ],
          },
        ],
      },
    });
  });
});
