import {
  buildOfficialWhatsappDisplayFromInteractive,
  buildOfficialWhatsappDisplayFromTemplate,
} from '@core/common/functions/officialWhatsappDisplay';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { EMessageType } from '@core/common/enums/EMessageType';

describe('officialWhatsappDisplay', () => {
  it('normalizes outbound official reply buttons for chat rendering', () => {
    const display = buildOfficialWhatsappDisplayFromInteractive(
      {
        type: 'button',
        body: { text: 'Escolha uma opção' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'yes', title: 'Sim' } },
            { type: 'reply', reply: { id: 'no', title: 'Não' } },
          ],
        },
      },
      'button'
    );

    expect(display).toEqual(
      expect.objectContaining({
        kind: 'button',
        raw_type: 'button',
        body: 'Escolha uma opção',
        actions: [
          expect.objectContaining({ id: 'yes', title: 'Sim' }),
          expect.objectContaining({ id: 'no', title: 'Não' }),
        ],
      })
    );
  });

  it('normalizes outbound official product lists with sections', () => {
    const display = buildOfficialWhatsappDisplayFromInteractive(
      {
        type: 'product_list',
        body: { text: 'Veja os produtos' },
        action: {
          catalog_id: 'catalog-1',
          sections: [
            {
              title: 'Produtos',
              product_items: [{ product_retailer_id: 'sku-1' }],
            },
          ],
        },
      },
      'product_list'
    );

    expect(display).toEqual(
      expect.objectContaining({
        kind: 'product_list',
        body: 'Veja os produtos',
        sections: [
          expect.objectContaining({
            title: 'Produtos',
            rows: [expect.objectContaining({ id: 'sku-1' })],
          }),
        ],
      })
    );
  });

  it('normalizes official templates with preview data', () => {
    const display = buildOfficialWhatsappDisplayFromTemplate(
      {
        name: 'template_aprovado',
        language: 'pt_BR',
        preview: {
          header: 'Olá',
          body: 'Seu atendimento será iniciado',
          footer: 'Underchat',
          buttons: ['Continuar'],
        },
      },
      'Seu atendimento será iniciado'
    );

    expect(display).toEqual(
      expect.objectContaining({
        kind: 'template',
        title: 'Olá',
        body: 'Seu atendimento será iniciado',
        footer: 'Underchat',
        actions: [expect.objectContaining({ title: 'Continuar' })],
      })
    );
  });

  it('does not expose template technical name or language as display text', () => {
    const display = buildOfficialWhatsappDisplayFromTemplate(
      {
        name: 'abertura',
        language: 'en',
        preview: {
          body: 'Olá, tudo bem?',
          buttons: ['Qualquer dúvida'],
        },
      },
      'Olá, tudo bem?'
    );

    expect(display).toEqual(
      expect.objectContaining({
        kind: 'template',
        title: null,
        body: 'Olá, tudo bem?',
        footer: null,
        actions: [expect.objectContaining({ title: 'Qualquer dúvida' })],
      })
    );
  });

  it('uses official display as text preview when regular message text is absent', () => {
    expect(
      extractMessageTextFromContent({
        type: EMessageType.official_interactive,
        official: {
          provider: 'meta_whatsapp',
          type: 'interactive',
          display: {
            kind: 'carousel',
            body: 'Confira as opções',
            cards: [{ title: 'Card 1' }],
          },
        },
      })
    ).toBe('Confira as opções');
  });
});
