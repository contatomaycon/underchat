import { Value } from '@sinclair/typebox/value';
import { OFFICIAL_WHATSAPP_INTERACTIVE_LIMITS as LIMITS } from '@core/common/constants/officialWhatsappInteractiveLimits';
import { OfficialWhatsappInteractiveValidationError } from '@core/common/exceptions/OfficialWhatsappInteractiveValidationError';
import {
  assertOfficialWhatsappInteractivePayload,
  countOfficialWhatsappCharacters,
  validateOfficialWhatsappInteractiveNodeData,
  validateOfficialWhatsappInteractivePayload,
} from '@core/common/functions/officialWhatsappInteractiveValidation';
import { officialWhatsappInteractivePayloadSchema } from '@core/schema/common/officialWhatsappInteractive.schema';

const listPayload = (rows: number = LIMITS.listTotalRows) => ({
  type: 'list',
  header: { type: 'text', text: 'H'.repeat(LIMITS.headerText) },
  body: { text: 'B'.repeat(LIMITS.bodyText) },
  footer: { text: 'F'.repeat(LIMITS.footerText) },
  action: {
    button: 'A'.repeat(LIMITS.listButtonText),
    sections: [
      {
        title: 'S'.repeat(LIMITS.listSectionTitle),
        rows: Array.from({ length: rows }, (_, index) => ({
          id: `${index}${'I'.repeat(LIMITS.listRowId - String(index).length)}`,
          title: 'T'.repeat(LIMITS.listRowTitle),
          description: 'D'.repeat(LIMITS.listRowDescription),
        })),
      },
    ],
  },
});

describe('official WhatsApp interactive limits', () => {
  it('accepts list fields exactly at every supported limit', () => {
    const payload = listPayload();

    expect(validateOfficialWhatsappInteractivePayload(payload)).toEqual([]);
    expect(Value.Check(officialWhatsappInteractivePayloadSchema, payload)).toBe(
      true
    );
    expect(() =>
      assertOfficialWhatsappInteractivePayload(payload)
    ).not.toThrow();
  });

  it('reports every overflowing list field and total rows without truncation', () => {
    const payload = listPayload(LIMITS.listTotalRows + 1);
    payload.header.text += 'H';
    payload.body.text += 'B';
    payload.footer.text += 'F';
    payload.action.button += 'A';
    payload.action.sections[0].title += 'S';
    payload.action.sections[0].rows[0].id += 'I';
    payload.action.sections[0].rows[0].title += 'T';
    payload.action.sections[0].rows[0].description += 'D';

    const issues = validateOfficialWhatsappInteractivePayload(payload);

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        'header.text',
        'body.text',
        'footer.text',
        'action.button',
        'action.sections[0].title',
        'action.sections[0].rows[0].id',
        'action.sections[0].rows[0].title',
        'action.sections[0].rows[0].description',
        'action.sections.rows',
      ])
    );
    expect(() => assertOfficialWhatsappInteractivePayload(payload)).toThrow(
      OfficialWhatsappInteractiveValidationError
    );
    expect(Value.Check(officialWhatsappInteractivePayloadSchema, payload)).toBe(
      false
    );
  });

  it('enforces reply button count, id and title limits', () => {
    const payload = {
      type: 'button',
      body: { text: 'Escolha' },
      action: {
        buttons: Array.from(
          { length: LIMITS.replyButtons + 1 },
          (_, index) => ({
            type: 'reply',
            reply: {
              id:
                index === 0
                  ? 'I'.repeat(LIMITS.replyButtonId + 1)
                  : String(index),
              title:
                index === 0
                  ? 'T'.repeat(LIMITS.replyButtonTitle + 1)
                  : `Opção ${index}`,
            },
          })
        ),
      },
    };

    expect(
      validateOfficialWhatsappInteractivePayload(payload).map(
        (issue) => issue.field
      )
    ).toEqual(
      expect.arrayContaining([
        'action.buttons',
        'action.buttons[0].reply.id',
        'action.buttons[0].reply.title',
      ])
    );
  });

  it.each([
    ['cta_url', 'display_text', LIMITS.ctaUrlDisplayText],
    ['flow', 'flow_cta', LIMITS.flowCta],
  ] as const)('enforces the %s action label limit', (type, field, limit) => {
    const payload = {
      type,
      body: { text: 'Mensagem' },
      action: {
        name: type,
        parameters: {
          [field]: 'A'.repeat(limit + 1),
          ...(type === 'cta_url' ? { url: 'https://example.com' } : {}),
        },
      },
    };

    expect(validateOfficialWhatsappInteractivePayload(payload)).toContainEqual(
      expect.objectContaining({
        field: `action.parameters.${field}`,
        limit,
        actual: limit + 1,
      })
    );
  });

  it('accepts the Google Sites CTA URL and rejects non-HTTP destinations', () => {
    const googleSitesUrl =
      'https://sites.google.com/contabilidadehohl.com.br/atendimento';
    const payload = {
      type: 'cta_url',
      body: { text: 'Abrir link' },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Clique aqui',
          url: googleSitesUrl,
        },
      },
    };

    expect(validateOfficialWhatsappInteractivePayload(payload)).toEqual([]);
    expect(
      validateOfficialWhatsappInteractiveNodeData('officialCtaUrl', {
        message: 'Abrir link',
        buttonText: 'Clique aqui',
        url: googleSitesUrl,
      })
    ).toEqual([]);

    payload.action.parameters.url = 'javascript:alert(1)';
    expect(validateOfficialWhatsappInteractivePayload(payload)).toContainEqual({
      code: 'invalid_url',
      field: 'action.parameters.url',
    });
    expect(
      validateOfficialWhatsappInteractiveNodeData('officialCtaUrl', {
        url: 'sites.google.com/contabilidadehohl.com.br/atendimento',
      })
    ).toContainEqual({ code: 'invalid_url', field: 'url' });
  });

  it.each(['Abrir 🚀', 'Abrir 🇧🇷', 'Abrir 1️⃣', 'Abrir 👍🏽'])(
    'rejects every emoji form in the Flow CTA at authoring and runtime boundaries: %s',
    (flowCta) => {
      expect(
        validateOfficialWhatsappInteractivePayload({
          type: 'flow',
          action: {
            name: 'flow',
            parameters: { flow_cta: flowCta },
          },
        })
      ).toContainEqual({
        code: 'emoji_not_allowed',
        field: 'action.parameters.flow_cta',
      });
      expect(
        validateOfficialWhatsappInteractiveNodeData('officialFlow', {
          buttonText: flowCta,
        })
      ).toContainEqual({
        code: 'emoji_not_allowed',
        field: 'buttonText',
      });
    }
  );

  it('accepts product-list section and product totals exactly at the limits', () => {
    const payload = {
      type: 'product_list',
      header: { type: 'text', text: 'Produtos' },
      body: { text: 'Escolha' },
      action: {
        catalog_id: 'catalog-1',
        sections: Array.from(
          { length: LIMITS.productListSections },
          (_, sectionIndex) => ({
            title: 'S'.repeat(LIMITS.productListSectionTitle),
            product_items: Array.from({ length: 3 }, (_, productIndex) => ({
              product_retailer_id: `${sectionIndex}-${productIndex}`,
            })),
          })
        ),
      },
    };

    expect(validateOfficialWhatsappInteractivePayload(payload)).toEqual([]);
    expect(Value.Check(officialWhatsappInteractivePayloadSchema, payload)).toBe(
      true
    );
  });

  it('rejects product-list overflow and required-field violations', () => {
    const sections = Array.from(
      { length: LIMITS.productListSections + 1 },
      (_, sectionIndex) => ({
        title:
          sectionIndex === 0
            ? 'S'.repeat(LIMITS.productListSectionTitle + 1)
            : `Seção ${sectionIndex}`,
        product_items: Array.from({ length: 3 }, (_, productIndex) => ({
          product_retailer_id: `${sectionIndex}-${productIndex}`,
        })),
      })
    );
    const issues = validateOfficialWhatsappInteractivePayload({
      type: 'product_list',
      action: { sections },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'required_field',
          field: 'header.text',
        }),
        expect.objectContaining({ code: 'required_field', field: 'body.text' }),
        expect.objectContaining({
          code: 'max_items',
          field: 'action.sections',
          limit: LIMITS.productListSections,
        }),
        expect.objectContaining({
          code: 'max_items',
          field: 'action.sections.product_items',
          limit: LIMITS.productListItems,
        }),
        expect.objectContaining({
          code: 'max_length',
          field: 'action.sections[0].title',
        }),
      ])
    );
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    const emojiTitle = '😀'.repeat(LIMITS.replyButtonTitle);
    const payload = {
      type: 'button' as const,
      action: {
        buttons: [
          { type: 'reply' as const, reply: { id: 'emoji', title: emojiTitle } },
        ],
      },
    };
    expect(countOfficialWhatsappCharacters(emojiTitle)).toBe(
      LIMITS.replyButtonTitle
    );
    expect(validateOfficialWhatsappInteractivePayload(payload)).toEqual([]);
    expect(Value.Check(officialWhatsappInteractivePayloadSchema, payload)).toBe(
      true
    );
  });

  it('validates legacy list section aliases at chatbot save time', () => {
    const issues = validateOfficialWhatsappInteractiveNodeData('officialList', {
      message: 'Escolha',
      buttonText: 'Selecionar',
      listSections: [
        {
          title: 'S'.repeat(LIMITS.listSectionTitle + 1),
          items: Array.from(
            { length: LIMITS.listTotalRows + 1 },
            (_, index) => ({
              value: `row-${index}`,
              text:
                index === 0
                  ? 'T'.repeat(LIMITS.listRowTitle + 1)
                  : `Linha ${index}`,
            })
          ),
        },
      ],
    });

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        'sections[0].title',
        'sections[0].rows[0].title',
        'sections.rows',
      ])
    );
  });

  it('enforces common carousel text limits without pretending to model its cards', () => {
    const payload = {
      type: 'carousel',
      header: { type: 'text', text: 'H'.repeat(LIMITS.headerText + 1) },
      body: { text: 'B'.repeat(LIMITS.bodyText + 1) },
      footer: { text: 'F'.repeat(LIMITS.footerText + 1) },
      action: { cards: [{ card_index: 0 }] },
    };

    expect(
      validateOfficialWhatsappInteractivePayload(payload).map(
        (issue) => issue.field
      )
    ).toEqual(['header.text', 'body.text', 'footer.text']);
    expect(
      validateOfficialWhatsappInteractiveNodeData('officialMediaCarousel', {
        header: 'H'.repeat(LIMITS.headerText + 1),
        message: 'B'.repeat(LIMITS.bodyText + 1),
        footer: 'F'.repeat(LIMITS.footerText + 1),
        cards: [{ card_index: 0 }],
      }).map((issue) => issue.field)
    ).toEqual(['message', 'header', 'footer']);
    expect(Value.Check(officialWhatsappInteractivePayloadSchema, payload)).toBe(
      false
    );
  });
});
