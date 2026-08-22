import { OFFICIAL_WHATSAPP_INTERACTIVE_LIMITS as LIMITS } from '@core/common/constants/officialWhatsappInteractiveLimits';
import {
  OfficialWhatsappInteractiveValidationError,
  OfficialWhatsappInteractiveValidationIssue,
} from '@core/common/exceptions/OfficialWhatsappInteractiveValidationError';

type UnknownRecord = Record<string, unknown>;

// Extended_Pictographic alone does not cover flags, keycaps or standalone
// modifiers. Meta rejects all of those in a Flow CTA label as emoji.
const OFFICIAL_FLOW_EMOJI_PATTERN =
  /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u20E3)/u;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const unicodeLength = (value: string): number => Array.from(value).length;

const addMaxLengthIssue = (
  issues: OfficialWhatsappInteractiveValidationIssue[],
  value: unknown,
  field: string,
  limit: number
): void => {
  if (typeof value !== 'string') return;

  const actual = unicodeLength(value);
  if (actual > limit) {
    issues.push({ code: 'max_length', field, limit, actual });
  }
};

const addMaxItemsIssue = (
  issues: OfficialWhatsappInteractiveValidationIssue[],
  actual: number,
  field: string,
  limit: number
): void => {
  if (actual > limit) {
    issues.push({ code: 'max_items', field, limit, actual });
  }
};

const addConfiguredMaxLengthIssue = (
  issues: OfficialWhatsappInteractiveValidationIssue[],
  value: unknown,
  field: string,
  limit: number
): void => {
  // Authoring-time values can expand or shrink through runtime variables. The
  // final payload validator remains authoritative after that resolution.
  if (typeof value === 'string' && /\{\{[^{}]+\}\}/u.test(value)) return;
  addMaxLengthIssue(issues, value, field, limit);
};

const hasConfiguredValue = (value: unknown): boolean =>
  value !== null &&
  value !== undefined &&
  !(typeof value === 'string' && value.trim().length === 0);

const containsRuntimeVariable = (value: unknown): boolean =>
  typeof value === 'string' && /\{\{[^{}]+\}\}/u.test(value);

const isHttpUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || value.trim().length === 0) return false;

  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const addHttpUrlIssue = (
  issues: OfficialWhatsappInteractiveValidationIssue[],
  value: unknown,
  field: string,
  options?: { allowRuntimeVariable?: boolean }
): void => {
  if (
    options?.allowRuntimeVariable === true &&
    containsRuntimeVariable(value)
  ) {
    return;
  }

  if (hasConfiguredValue(value) && !isHttpUrl(value)) {
    issues.push({ code: 'invalid_url', field });
  }
};

const addRequiredFieldIssue = (
  issues: OfficialWhatsappInteractiveValidationIssue[],
  value: unknown,
  field: string
): void => {
  if (!hasConfiguredValue(value)) {
    issues.push({ code: 'required_field', field });
  }
};

const addFlowEmojiIssue = (
  issues: OfficialWhatsappInteractiveValidationIssue[],
  value: unknown,
  field: string
): void => {
  if (typeof value === 'string' && OFFICIAL_FLOW_EMOJI_PATTERN.test(value)) {
    issues.push({ code: 'emoji_not_allowed', field });
  }
};

const getNestedOfficialValue = (
  data: UnknownRecord,
  field: string
): unknown => {
  const direct = data[field];
  if (
    direct !== null &&
    direct !== undefined &&
    !(typeof direct === 'string' && direct.trim().length === 0)
  ) {
    return direct;
  }

  return asRecord(data.official)?.[field];
};

const validateCommonPayloadFields = (
  interactive: UnknownRecord,
  issues: OfficialWhatsappInteractiveValidationIssue[]
): void => {
  const header = asRecord(interactive.header);
  if (header?.type === 'text' || typeof header?.text === 'string') {
    addMaxLengthIssue(issues, header.text, 'header.text', LIMITS.headerText);
  }

  addMaxLengthIssue(
    issues,
    asRecord(interactive.body)?.text,
    'body.text',
    LIMITS.bodyText
  );
  addMaxLengthIssue(
    issues,
    asRecord(interactive.footer)?.text,
    'footer.text',
    LIMITS.footerText
  );
};

const validateReplyButtonPayload = (
  interactive: UnknownRecord,
  issues: OfficialWhatsappInteractiveValidationIssue[]
): void => {
  const buttons = asArray(asRecord(interactive.action)?.buttons);
  addMaxItemsIssue(
    issues,
    buttons.length,
    'action.buttons',
    LIMITS.replyButtons
  );

  buttons.forEach((button, index) => {
    const reply = asRecord(asRecord(button)?.reply);
    if (!reply) return;

    addMaxLengthIssue(
      issues,
      reply.id,
      `action.buttons[${index}].reply.id`,
      LIMITS.replyButtonId
    );
    addMaxLengthIssue(
      issues,
      reply.title,
      `action.buttons[${index}].reply.title`,
      LIMITS.replyButtonTitle
    );
  });
};

const validateListPayload = (
  interactive: UnknownRecord,
  issues: OfficialWhatsappInteractiveValidationIssue[]
): void => {
  const action = asRecord(interactive.action);
  addMaxLengthIssue(
    issues,
    action?.button,
    'action.button',
    LIMITS.listButtonText
  );

  const sections = asArray(action?.sections);
  let rowsCount = 0;
  sections.forEach((section, sectionIndex) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) return;

    addMaxLengthIssue(
      issues,
      sectionRecord.title,
      `action.sections[${sectionIndex}].title`,
      LIMITS.listSectionTitle
    );

    const rows = asArray(sectionRecord.rows);
    rowsCount += rows.length;
    rows.forEach((row, rowIndex) => {
      const rowRecord = asRecord(row);
      if (!rowRecord) return;

      const rowPath = `action.sections[${sectionIndex}].rows[${rowIndex}]`;
      addMaxLengthIssue(
        issues,
        rowRecord.id,
        `${rowPath}.id`,
        LIMITS.listRowId
      );
      addMaxLengthIssue(
        issues,
        rowRecord.title,
        `${rowPath}.title`,
        LIMITS.listRowTitle
      );
      addMaxLengthIssue(
        issues,
        rowRecord.description,
        `${rowPath}.description`,
        LIMITS.listRowDescription
      );
    });
  });

  addMaxItemsIssue(
    issues,
    rowsCount,
    'action.sections.rows',
    LIMITS.listTotalRows
  );
};

const validateProductListPayload = (
  interactive: UnknownRecord,
  issues: OfficialWhatsappInteractiveValidationIssue[]
): void => {
  addRequiredFieldIssue(
    issues,
    asRecord(interactive.header)?.text,
    'header.text'
  );
  addRequiredFieldIssue(issues, asRecord(interactive.body)?.text, 'body.text');

  const sections = asArray(asRecord(interactive.action)?.sections);
  addMaxItemsIssue(
    issues,
    sections.length,
    'action.sections',
    LIMITS.productListSections
  );

  let itemsCount = 0;
  sections.forEach((section, sectionIndex) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) return;
    addMaxLengthIssue(
      issues,
      sectionRecord.title,
      `action.sections[${sectionIndex}].title`,
      LIMITS.productListSectionTitle
    );
    itemsCount += asArray(sectionRecord.product_items).length;
  });
  addMaxItemsIssue(
    issues,
    itemsCount,
    'action.sections.product_items',
    LIMITS.productListItems
  );
};

export const validateOfficialWhatsappInteractivePayload = (
  interactive: unknown
): OfficialWhatsappInteractiveValidationIssue[] => {
  const payload = asRecord(interactive);
  if (!payload) return [];

  const issues: OfficialWhatsappInteractiveValidationIssue[] = [];
  validateCommonPayloadFields(payload, issues);

  if (payload.type === 'button') {
    validateReplyButtonPayload(payload, issues);
  } else if (payload.type === 'list') {
    validateListPayload(payload, issues);
  } else if (payload.type === 'cta_url') {
    const parameters = asRecord(asRecord(payload.action)?.parameters);
    addMaxLengthIssue(
      issues,
      parameters?.display_text,
      'action.parameters.display_text',
      LIMITS.ctaUrlDisplayText
    );
    addRequiredFieldIssue(issues, asRecord(payload.body)?.text, 'body.text');
    addRequiredFieldIssue(
      issues,
      parameters?.display_text,
      'action.parameters.display_text'
    );
    addRequiredFieldIssue(issues, parameters?.url, 'action.parameters.url');
    addHttpUrlIssue(issues, parameters?.url, 'action.parameters.url');
  } else if (payload.type === 'flow') {
    const flowCta = asRecord(asRecord(payload.action)?.parameters)?.flow_cta;
    addMaxLengthIssue(
      issues,
      flowCta,
      'action.parameters.flow_cta',
      LIMITS.flowCta
    );
    addFlowEmojiIssue(issues, flowCta, 'action.parameters.flow_cta');
  } else if (payload.type === 'product_list') {
    validateProductListPayload(payload, issues);
  }

  return issues;
};

export const assertOfficialWhatsappInteractivePayload = (
  interactive: unknown
): void => {
  const issues = validateOfficialWhatsappInteractivePayload(interactive);
  if (issues.length > 0) {
    throw new OfficialWhatsappInteractiveValidationError(issues);
  }
};

const OFFICIAL_COMMON_HEADER_NODE_TYPES = new Set([
  'officialReplyButtons',
  'officialList',
  'officialCtaUrl',
  'officialFlow',
  'officialMultiProduct',
  'officialCatalog',
  'officialMediaCarousel',
  'officialAddress',
]);

const OFFICIAL_COMMON_FOOTER_NODE_TYPES = new Set([
  ...OFFICIAL_COMMON_HEADER_NODE_TYPES,
  'officialSingleProduct',
]);

const OFFICIAL_COMMON_BODY_NODE_TYPES = new Set([
  ...OFFICIAL_COMMON_FOOTER_NODE_TYPES,
  'officialLocationRequest',
]);

const listRowsFromSection = (section: UnknownRecord): unknown[] => {
  const rows = getNestedOfficialValue(section, 'rows');
  if (Array.isArray(rows)) return rows;

  return asArray(getNestedOfficialValue(section, 'items'));
};

const configuredListSections = (data: UnknownRecord): unknown[] => {
  const sections = getNestedOfficialValue(data, 'sections');
  if (Array.isArray(sections) && sections.length > 0) return sections;

  return asArray(getNestedOfficialValue(data, 'listSections'));
};

const optionRecords = (data: UnknownRecord): UnknownRecord[] =>
  asArray(getNestedOfficialValue(data, 'options'))
    .map(asRecord)
    .filter((option): option is UnknownRecord => option !== null);

const validateOfficialListNodeData = (
  data: UnknownRecord,
  issues: OfficialWhatsappInteractiveValidationIssue[]
): void => {
  addConfiguredMaxLengthIssue(
    issues,
    getNestedOfficialValue(data, 'buttonText'),
    'buttonText',
    LIMITS.listButtonText
  );

  const fallbackTitle = getNestedOfficialValue(data, 'sectionTitle');
  addConfiguredMaxLengthIssue(
    issues,
    fallbackTitle,
    'sectionTitle',
    LIMITS.listSectionTitle
  );

  const sections = configuredListSections(data);
  if (sections.length === 0) {
    const options = optionRecords(data);
    addMaxItemsIssue(issues, options.length, 'options', LIMITS.listTotalRows);
    options.forEach((option, index) => {
      addConfiguredMaxLengthIssue(
        issues,
        option.id,
        `options[${index}].id`,
        LIMITS.listRowId
      );
      addConfiguredMaxLengthIssue(
        issues,
        option.text,
        `options[${index}].text`,
        LIMITS.listRowTitle
      );
      addConfiguredMaxLengthIssue(
        issues,
        option.description,
        `options[${index}].description`,
        LIMITS.listRowDescription
      );
    });
    return;
  }

  let rowsCount = 0;
  sections.forEach((section, sectionIndex) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) return;

    const sectionTitle = getNestedOfficialValue(sectionRecord, 'title');
    addConfiguredMaxLengthIssue(
      issues,
      sectionTitle ?? fallbackTitle,
      `sections[${sectionIndex}].title`,
      LIMITS.listSectionTitle
    );

    const rows = listRowsFromSection(sectionRecord);
    rowsCount += rows.length;
    rows.forEach((row, rowIndex) => {
      const rowRecord = asRecord(row);
      if (!rowRecord) return;

      const rowPath = `sections[${sectionIndex}].rows[${rowIndex}]`;
      addConfiguredMaxLengthIssue(
        issues,
        getNestedOfficialValue(rowRecord, 'id') ??
          getNestedOfficialValue(rowRecord, 'value') ??
          getNestedOfficialValue(rowRecord, 'product_retailer_id'),
        `${rowPath}.id`,
        LIMITS.listRowId
      );
      addConfiguredMaxLengthIssue(
        issues,
        getNestedOfficialValue(rowRecord, 'title') ??
          getNestedOfficialValue(rowRecord, 'text') ??
          getNestedOfficialValue(rowRecord, 'name'),
        `${rowPath}.title`,
        LIMITS.listRowTitle
      );
      addConfiguredMaxLengthIssue(
        issues,
        getNestedOfficialValue(rowRecord, 'description'),
        `${rowPath}.description`,
        LIMITS.listRowDescription
      );
    });
  });

  addMaxItemsIssue(issues, rowsCount, 'sections.rows', LIMITS.listTotalRows);
};

const validateOfficialProductListNodeData = (
  data: UnknownRecord,
  issues: OfficialWhatsappInteractiveValidationIssue[]
): void => {
  const header = getNestedOfficialValue(data, 'header');
  const message =
    getNestedOfficialValue(data, 'message') ??
    getNestedOfficialValue(data, 'text');
  addRequiredFieldIssue(issues, header, 'header');
  addRequiredFieldIssue(issues, message, 'message');

  const fallbackTitle = getNestedOfficialValue(data, 'sectionTitle');
  addConfiguredMaxLengthIssue(
    issues,
    fallbackTitle,
    'sectionTitle',
    LIMITS.productListSectionTitle
  );

  const sections = asArray(getNestedOfficialValue(data, 'sections'));
  if (sections.length === 0) {
    addMaxItemsIssue(
      issues,
      asArray(getNestedOfficialValue(data, 'products')).length,
      'products',
      LIMITS.productListItems
    );
    return;
  }

  addMaxItemsIssue(
    issues,
    sections.length,
    'sections',
    LIMITS.productListSections
  );
  let itemsCount = 0;
  sections.forEach((section, sectionIndex) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) return;
    addConfiguredMaxLengthIssue(
      issues,
      getNestedOfficialValue(sectionRecord, 'title') ?? fallbackTitle,
      `sections[${sectionIndex}].title`,
      LIMITS.productListSectionTitle
    );
    const items = asArray(
      getNestedOfficialValue(sectionRecord, 'product_items') ??
        getNestedOfficialValue(sectionRecord, 'products')
    );
    itemsCount += items.length;
  });
  addMaxItemsIssue(
    issues,
    itemsCount,
    'sections.product_items',
    LIMITS.productListItems
  );
};

export const validateOfficialWhatsappInteractiveNodeData = (
  nodeType: string,
  rawData: unknown
): OfficialWhatsappInteractiveValidationIssue[] => {
  const data = asRecord(rawData) ?? {};
  const issues: OfficialWhatsappInteractiveValidationIssue[] = [];

  if (OFFICIAL_COMMON_BODY_NODE_TYPES.has(nodeType)) {
    addConfiguredMaxLengthIssue(
      issues,
      getNestedOfficialValue(data, 'message') ??
        getNestedOfficialValue(data, 'text'),
      'message',
      LIMITS.bodyText
    );
  }

  if (OFFICIAL_COMMON_HEADER_NODE_TYPES.has(nodeType)) {
    addConfiguredMaxLengthIssue(
      issues,
      getNestedOfficialValue(data, 'header'),
      'header',
      LIMITS.headerText
    );
  }

  if (OFFICIAL_COMMON_FOOTER_NODE_TYPES.has(nodeType)) {
    addConfiguredMaxLengthIssue(
      issues,
      getNestedOfficialValue(data, 'footer'),
      'footer',
      LIMITS.footerText
    );
  }

  if (nodeType === 'officialReplyButtons') {
    const options = optionRecords(data);
    addMaxItemsIssue(issues, options.length, 'options', LIMITS.replyButtons);
    options.forEach((option, index) => {
      addConfiguredMaxLengthIssue(
        issues,
        option.id,
        `options[${index}].id`,
        LIMITS.replyButtonId
      );
      addConfiguredMaxLengthIssue(
        issues,
        option.text,
        `options[${index}].text`,
        LIMITS.replyButtonTitle
      );
    });
  } else if (nodeType === 'officialList') {
    validateOfficialListNodeData(data, issues);
  } else if (nodeType === 'officialCtaUrl') {
    addConfiguredMaxLengthIssue(
      issues,
      getNestedOfficialValue(data, 'buttonText'),
      'buttonText',
      LIMITS.ctaUrlDisplayText
    );
    addHttpUrlIssue(issues, getNestedOfficialValue(data, 'url'), 'url', {
      allowRuntimeVariable: true,
    });
  } else if (nodeType === 'officialFlow') {
    const flowCta = getNestedOfficialValue(data, 'buttonText');
    addConfiguredMaxLengthIssue(issues, flowCta, 'buttonText', LIMITS.flowCta);
    addFlowEmojiIssue(issues, flowCta, 'buttonText');
  } else if (nodeType === 'officialMultiProduct') {
    validateOfficialProductListNodeData(data, issues);
  }

  return issues;
};

export const countOfficialWhatsappCharacters = unicodeLength;
