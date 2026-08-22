export const OFFICIAL_INTERACTIVE_LIMITS = Object.freeze({
  header: 60,
  body: 1_024,
  footer: 60,
  listButtonTitle: 20,
  listOptionTitle: 24,
  listOptionDescription: 72,
  sectionTitle: 24,
  replyButtonTitle: 20,
  replyButtonCount: 3,
  ctaButtonTitle: 20,
  flowCtaTitle: 30,
  productSectionCount: 10,
  productItemCount: 30,
});

export type OfficialInteractiveLimitField =
  | 'header'
  | 'body'
  | 'footer'
  | 'listButtonTitle'
  | 'listOptionTitle'
  | 'listOptionDescription'
  | 'sectionTitle'
  | 'replyButtonTitle'
  | 'replyButtonCount'
  | 'ctaButtonTitle'
  | 'flowCtaTitle'
  | 'flowCtaEmoji'
  | 'productSectionCount'
  | 'productItemCount';

export interface OfficialInteractiveLimitViolation {
  field: OfficialInteractiveLimitField;
  fieldLabelKey: string;
  limit: number;
  actual: number;
  optionIndex?: number;
  sectionIndex?: number;
  kind?: 'length' | 'emoji';
}

const BODY_NODE_TYPES = new Set([
  'officialReplyButtons',
  'officialList',
  'officialCtaUrl',
  'officialLocationRequest',
  'officialFlow',
  'officialSingleProduct',
  'officialMultiProduct',
  'officialCatalog',
  'officialMediaCarousel',
  'officialAddress',
]);

const HEADER_NODE_TYPES = new Set([
  'officialReplyButtons',
  'officialList',
  'officialCtaUrl',
  'officialFlow',
  'officialMultiProduct',
  'officialCatalog',
  'officialMediaCarousel',
  'officialAddress',
]);

const FOOTER_NODE_TYPES = new Set([
  ...HEADER_NODE_TYPES,
  'officialSingleProduct',
]);

const readText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const OFFICIAL_FLOW_EMOJI_PATTERN =
  /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u20E3)/u;

export const countOfficialInteractiveCharacters = (value: unknown): number =>
  Array.from(readText(value)).length;

export const containsOfficialInteractiveEmoji = (value: unknown): boolean =>
  OFFICIAL_FLOW_EMOJI_PATTERN.test(readText(value));

const findTextViolation = (
  field: OfficialInteractiveLimitField,
  fieldLabelKey: string,
  value: unknown,
  limit: number,
  context: Pick<
    OfficialInteractiveLimitViolation,
    'optionIndex' | 'sectionIndex'
  > = {}
): OfficialInteractiveLimitViolation | null => {
  const actual = countOfficialInteractiveCharacters(value);
  return actual > limit
    ? { field, fieldLabelKey, limit, actual, ...context }
    : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const findOptionViolation = (
  options: unknown,
  input: {
    titleField: 'listOptionTitle' | 'replyButtonTitle';
    titleLabel: string;
    titleLimit: number;
    description?: boolean;
  }
): OfficialInteractiveLimitViolation | null => {
  if (!Array.isArray(options)) {
    return null;
  }

  for (const [optionIndex, option] of options.entries()) {
    const optionRecord = asRecord(option);
    if (!optionRecord) {
      continue;
    }

    const titleViolation = findTextViolation(
      input.titleField,
      input.titleLabel,
      optionRecord.text ?? optionRecord.title,
      input.titleLimit,
      { optionIndex }
    );
    if (titleViolation) {
      return titleViolation;
    }

    if (input.description) {
      const descriptionViolation = findTextViolation(
        'listOptionDescription',
        'chatbot_official_list_option_description',
        optionRecord.description,
        OFFICIAL_INTERACTIVE_LIMITS.listOptionDescription,
        { optionIndex }
      );
      if (descriptionViolation) {
        return descriptionViolation;
      }
    }
  }

  return null;
};

const findProductSectionViolation = (
  sections: unknown
): OfficialInteractiveLimitViolation | null => {
  if (!Array.isArray(sections)) {
    return null;
  }

  for (const [sectionIndex, section] of sections.entries()) {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) {
      continue;
    }

    const violation = findTextViolation(
      'sectionTitle',
      'chatbot_official_section_title',
      sectionRecord.title,
      OFFICIAL_INTERACTIVE_LIMITS.sectionTitle,
      { sectionIndex }
    );
    if (violation) {
      return violation;
    }
  }

  return null;
};

export const findOfficialInteractiveLimitViolation = (
  nodeType: string,
  data: Record<string, unknown> | undefined
): OfficialInteractiveLimitViolation | null => {
  if (!data) {
    return null;
  }

  if (HEADER_NODE_TYPES.has(nodeType)) {
    const headerViolation = findTextViolation(
      'header',
      'chatbot_official_header',
      data.header,
      OFFICIAL_INTERACTIVE_LIMITS.header
    );
    if (headerViolation) return headerViolation;
  }

  if (BODY_NODE_TYPES.has(nodeType)) {
    const bodyViolation = findTextViolation(
      'body',
      'chatbot_official_body',
      readText(data.message) || readText(data.text),
      OFFICIAL_INTERACTIVE_LIMITS.body
    );
    if (bodyViolation) return bodyViolation;
  }

  if (FOOTER_NODE_TYPES.has(nodeType)) {
    const footerViolation = findTextViolation(
      'footer',
      'chatbot_official_footer',
      data.footer,
      OFFICIAL_INTERACTIVE_LIMITS.footer
    );
    if (footerViolation) return footerViolation;
  }

  if (nodeType === 'officialReplyButtons') {
    const options = Array.isArray(data.options) ? data.options : [];
    if (options.length > OFFICIAL_INTERACTIVE_LIMITS.replyButtonCount) {
      return {
        field: 'replyButtonCount',
        fieldLabelKey: 'chatbot_official_reply_button_count',
        limit: OFFICIAL_INTERACTIVE_LIMITS.replyButtonCount,
        actual: options.length,
      };
    }

    return findOptionViolation(options, {
      titleField: 'replyButtonTitle',
      titleLabel: 'chatbot_official_reply_button_title',
      titleLimit: OFFICIAL_INTERACTIVE_LIMITS.replyButtonTitle,
    });
  }

  if (nodeType === 'officialList') {
    return (
      findTextViolation(
        'listButtonTitle',
        'chatbot_official_list_open_button',
        data.buttonText,
        OFFICIAL_INTERACTIVE_LIMITS.listButtonTitle
      ) ??
      findTextViolation(
        'sectionTitle',
        'chatbot_official_section_title',
        data.sectionTitle,
        OFFICIAL_INTERACTIVE_LIMITS.sectionTitle
      ) ??
      findOptionViolation(data.options, {
        titleField: 'listOptionTitle',
        titleLabel: 'chatbot_official_list_option_title',
        titleLimit: OFFICIAL_INTERACTIVE_LIMITS.listOptionTitle,
        description: true,
      })
    );
  }

  if (nodeType === 'officialCtaUrl') {
    return findTextViolation(
      'ctaButtonTitle',
      'chatbot_official_cta_button_title',
      data.buttonText,
      OFFICIAL_INTERACTIVE_LIMITS.ctaButtonTitle
    );
  }

  if (nodeType === 'officialFlow') {
    const lengthViolation = findTextViolation(
      'flowCtaTitle',
      'chatbot_official_flow_cta_title',
      data.buttonText,
      OFFICIAL_INTERACTIVE_LIMITS.flowCtaTitle
    );
    if (lengthViolation) {
      return lengthViolation;
    }

    if (containsOfficialInteractiveEmoji(data.buttonText)) {
      return {
        field: 'flowCtaEmoji',
        fieldLabelKey: 'chatbot_official_flow_cta_title',
        limit: 0,
        actual: 1,
        kind: 'emoji',
      };
    }

    return null;
  }

  if (nodeType === 'officialMultiProduct') {
    const sections = Array.isArray(data.sections) ? data.sections : [];
    if (sections.length > OFFICIAL_INTERACTIVE_LIMITS.productSectionCount) {
      return {
        field: 'productSectionCount',
        fieldLabelKey: 'chatbot_official_product_section_count',
        limit: OFFICIAL_INTERACTIVE_LIMITS.productSectionCount,
        actual: sections.length,
      };
    }

    const sectionProductCount = sections.reduce((total, section) => {
      const sectionRecord = asRecord(section);
      if (!sectionRecord) return total;
      const products = Array.isArray(sectionRecord.product_items)
        ? sectionRecord.product_items
        : Array.isArray(sectionRecord.products)
          ? sectionRecord.products
          : [];
      return total + products.length;
    }, 0);
    const productCount =
      sections.length > 0
        ? sectionProductCount
        : Array.isArray(data.products)
          ? data.products.length
          : 0;
    if (productCount > OFFICIAL_INTERACTIVE_LIMITS.productItemCount) {
      return {
        field: 'productItemCount',
        fieldLabelKey: 'chatbot_official_product_item_count',
        limit: OFFICIAL_INTERACTIVE_LIMITS.productItemCount,
        actual: productCount,
      };
    }

    return findProductSectionViolation(sections);
  }

  return null;
};
