import { Static, Type } from '@sinclair/typebox';
import { OFFICIAL_WHATSAPP_INTERACTIVE_LIMITS as LIMITS } from '@core/common/constants/officialWhatsappInteractiveLimits';

const unicodeLimitedString = (limit: number) =>
  Type.String({
    pattern: `^(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[^\\uD800-\\uDFFF]){0,${limit}}$`,
    'x-characterLimit': limit,
  });

export const officialWhatsappInteractiveHeaderSchema = Type.Object(
  {
    type: Type.Literal('text'),
    text: unicodeLimitedString(LIMITS.headerText),
  },
  { additionalProperties: true }
);

export const officialWhatsappInteractiveBodySchema = Type.Object(
  {
    text: unicodeLimitedString(LIMITS.bodyText),
  },
  { additionalProperties: true }
);

export const officialWhatsappInteractiveFooterSchema = Type.Object(
  {
    text: unicodeLimitedString(LIMITS.footerText),
  },
  { additionalProperties: true }
);

const officialWhatsappCommonInteractiveProperties = {
  header: Type.Optional(officialWhatsappInteractiveHeaderSchema),
  body: Type.Optional(officialWhatsappInteractiveBodySchema),
  footer: Type.Optional(officialWhatsappInteractiveFooterSchema),
};

export const officialWhatsappReplyButtonSchema = Type.Object(
  {
    type: Type.Literal('reply'),
    reply: Type.Object(
      {
        id: unicodeLimitedString(LIMITS.replyButtonId),
        title: unicodeLimitedString(LIMITS.replyButtonTitle),
      },
      { additionalProperties: true }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappReplyButtonsInteractiveSchema = Type.Object(
  {
    type: Type.Literal('button'),
    ...officialWhatsappCommonInteractiveProperties,
    action: Type.Object(
      {
        buttons: Type.Array(officialWhatsappReplyButtonSchema, {
          maxItems: LIMITS.replyButtons,
        }),
      },
      { additionalProperties: true }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappListRowSchema = Type.Object(
  {
    id: unicodeLimitedString(LIMITS.listRowId),
    title: unicodeLimitedString(LIMITS.listRowTitle),
    description: Type.Optional(unicodeLimitedString(LIMITS.listRowDescription)),
  },
  { additionalProperties: true }
);

export const officialWhatsappListSectionSchema = Type.Object(
  {
    title: unicodeLimitedString(LIMITS.listSectionTitle),
    rows: Type.Array(officialWhatsappListRowSchema, {
      maxItems: LIMITS.listTotalRows,
    }),
  },
  { additionalProperties: true }
);

export const officialWhatsappListInteractiveSchema = Type.Object(
  {
    type: Type.Literal('list'),
    ...officialWhatsappCommonInteractiveProperties,
    action: Type.Object(
      {
        button: unicodeLimitedString(LIMITS.listButtonText),
        sections: Type.Array(officialWhatsappListSectionSchema),
      },
      { additionalProperties: true }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappCtaUrlInteractiveSchema = Type.Object(
  {
    type: Type.Literal('cta_url'),
    ...officialWhatsappCommonInteractiveProperties,
    action: Type.Object(
      {
        name: Type.Literal('cta_url'),
        parameters: Type.Object(
          {
            display_text: unicodeLimitedString(LIMITS.ctaUrlDisplayText),
            url: Type.String(),
          },
          { additionalProperties: true }
        ),
      },
      { additionalProperties: true }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappFlowInteractiveSchema = Type.Object(
  {
    type: Type.Literal('flow'),
    ...officialWhatsappCommonInteractiveProperties,
    action: Type.Object(
      {
        name: Type.Literal('flow'),
        parameters: Type.Object(
          {
            flow_cta: unicodeLimitedString(LIMITS.flowCta),
          },
          { additionalProperties: true }
        ),
      },
      { additionalProperties: true }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappProductListSectionSchema = Type.Object(
  {
    title: unicodeLimitedString(LIMITS.productListSectionTitle),
    product_items: Type.Array(
      Type.Object(
        { product_retailer_id: Type.String() },
        { additionalProperties: true }
      ),
      { maxItems: LIMITS.productListItems }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappProductListInteractiveSchema = Type.Object(
  {
    type: Type.Literal('product_list'),
    header: officialWhatsappInteractiveHeaderSchema,
    body: officialWhatsappInteractiveBodySchema,
    footer: Type.Optional(officialWhatsappInteractiveFooterSchema),
    action: Type.Object(
      {
        sections: Type.Array(officialWhatsappProductListSectionSchema, {
          maxItems: LIMITS.productListSections,
        }),
      },
      { additionalProperties: true }
    ),
  },
  { additionalProperties: true }
);

export const officialWhatsappSingleProductInteractiveSchema = Type.Object(
  {
    type: Type.Literal('product'),
    body: Type.Optional(officialWhatsappInteractiveBodySchema),
    footer: Type.Optional(officialWhatsappInteractiveFooterSchema),
    action: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: false }
);

export const officialWhatsappCommonInteractiveSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('location_request_message'),
      Type.Literal('catalog_message'),
      Type.Literal('address_message'),
      Type.Literal('call_permission_request'),
    ]),
    ...officialWhatsappCommonInteractiveProperties,
  },
  { additionalProperties: true }
);

/**
 * Interactive payloads with a fully modeled structural contract. Carousel
 * cards remain outside this union because their card-specific contract is
 * separate; their common header/body/footer limits are still enforced by the
 * domain validator. The total row limit across multiple list sections is
 * enforced by that validator in addition to this structural schema.
 */
export const officialWhatsappInteractivePayloadSchema = Type.Union([
  officialWhatsappReplyButtonsInteractiveSchema,
  officialWhatsappListInteractiveSchema,
  officialWhatsappCtaUrlInteractiveSchema,
  officialWhatsappFlowInteractiveSchema,
  officialWhatsappProductListInteractiveSchema,
  officialWhatsappSingleProductInteractiveSchema,
  officialWhatsappCommonInteractiveSchema,
]);

export type OfficialWhatsappInteractivePayload = Static<
  typeof officialWhatsappInteractivePayloadSchema
>;
