import type {
  MessageContent,
  OfficialDisplayAction,
  OfficialDisplayCard,
  OfficialDisplayMetadata,
  OfficialDisplaySection,
  OfficialTemplateVariableValue,
} from '../types/chat';
import { buildOfficialTemplatePreview } from './officialTemplate';

export type OfficialVisibleAction = OfficialDisplayAction & {
  label: string;
  safe_url: string | null;
  description_text: string | null;
};

export type OfficialListOptionSection = Omit<
  OfficialDisplaySection,
  'rows' | 'items'
> & {
  rows: OfficialVisibleAction[];
};

export type OfficialSubmittedEntry = {
  key: string;
  value: string;
};

export type OfficialDisplayModel = {
  display: OfficialDisplayMetadata;
  title: string | null;
  body: string | null;
  footer: string | null;
  visibleActions: OfficialVisibleAction[];
  visibleItems: OfficialVisibleAction[];
  visibleSections: OfficialDisplaySection[];
  visibleCards: OfficialDisplayCard[];
  listOptionSections: OfficialListOptionSection[];
  submittedEntries: OfficialSubmittedEntry[];
  collapsedActionLabel: string | null;
  actionLabel: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  isMediaVideo: boolean;
  shouldShowInlineSections: boolean;
  shouldShowActionRows: boolean;
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isSafeOfficialUrl(
  url: string | null | undefined
): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

export function officialTemplateValuesFromTemplate(
  template: MessageContent['official_template']
): OfficialTemplateVariableValue[] {
  return (template?.variables ?? []).map((variable) => ({
    key: variable.key,
    component_type: variable.component_type,
    index: variable.index,
    button_index: variable.button_index ?? null,
    value: variable.value ?? variable.sample ?? '',
  }));
}

export function getOfficialActionLabel(
  action: OfficialDisplayAction | null | undefined
): string | null {
  return (
    readNonEmptyString(action?.title) ||
    readNonEmptyString(action?.description) ||
    readNonEmptyString(action?.url) ||
    readNonEmptyString(action?.phone_number) ||
    readNonEmptyString(action?.id)
  );
}

export function getOfficialActionDescription(
  action: OfficialDisplayAction | null | undefined
): string | null {
  const label = getOfficialActionLabel(action);
  const description = readNonEmptyString(action?.description);
  if (!description || description === label) return null;
  return description;
}

function toVisibleAction(
  action: OfficialDisplayAction | null | undefined
): OfficialVisibleAction | null {
  if (!action) return null;
  const label = getOfficialActionLabel(action);
  if (!label) return null;

  const url = readNonEmptyString(action.url);
  return {
    ...action,
    label,
    safe_url: isSafeOfficialUrl(url) ? url : null,
    description_text: getOfficialActionDescription(action),
  };
}

export function getVisibleOfficialActions(
  actions: OfficialDisplayAction[] | undefined
): OfficialVisibleAction[] {
  return (actions ?? [])
    .map((action) => toVisibleAction(action))
    .filter((action): action is OfficialVisibleAction => action !== null);
}

export function getFirstVisibleOfficialAction(
  actions: OfficialDisplayAction[] | undefined
): OfficialVisibleAction | null {
  return getVisibleOfficialActions(actions)[0] ?? null;
}

export function getOfficialReplyTitle(
  display: OfficialDisplayMetadata,
  content: MessageContent,
  selectedAction: OfficialDisplayAction | null
): string {
  return (
    readNonEmptyString(selectedAction?.title) ||
    readNonEmptyString(display.action_label) ||
    readNonEmptyString(display.title) ||
    readNonEmptyString(content.message) ||
    readNonEmptyString(selectedAction?.id) ||
    'Resposta'
  );
}

export function getOfficialReplyDescription(
  display: OfficialDisplayMetadata,
  selectedAction: OfficialDisplayAction | null,
  replyTitle: string
): string | null {
  const description =
    readNonEmptyString(selectedAction?.description) ||
    readNonEmptyString(display.body);

  if (!description || description === replyTitle) return null;
  return description;
}

export function getOfficialReplyContextText(
  display: OfficialDisplayMetadata,
  content: MessageContent,
  replyTitle: string,
  replyDescription: string | null
): string | null {
  const quotedText = readNonEmptyString(content.quoted?.message);
  if (quotedText && quotedText !== replyTitle) return quotedText;

  const body = readNonEmptyString(display.body);
  if (body && body !== replyTitle && body !== replyDescription) return body;

  return null;
}

function normalizeTemplateMetaText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeTemplateLanguageCode(value: string | null | undefined) {
  return normalizeTemplateMetaText(value).replace(/_/g, '-');
}

function isLikelyTechnicalTemplateName(
  value: string | null | undefined
): boolean {
  const normalized = normalizeTemplateMetaText(value);
  return /^[a-z0-9_]+$/u.test(normalized) && normalized.length > 0;
}

function isLikelyTemplateLanguageCode(
  value: string | null | undefined
): boolean {
  const normalized = normalizeTemplateMetaText(value);
  return /^[a-z]{2}(?:[-_][a-z]{2})?$/iu.test(normalized);
}

function shouldHideTemplateTitle(input: {
  title: string | null;
  body: string | null;
  footer: string | null;
  templateName?: string | null;
}): boolean {
  if (!input.title || !input.body) return false;

  if (
    input.templateName &&
    normalizeTemplateMetaText(input.title) ===
      normalizeTemplateMetaText(input.templateName)
  ) {
    return true;
  }

  return (
    isLikelyTechnicalTemplateName(input.title) &&
    isLikelyTemplateLanguageCode(input.footer)
  );
}

function shouldHideTemplateFooter(input: {
  title: string | null;
  body: string | null;
  footer: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
}): boolean {
  if (!input.footer) return false;

  if (
    input.templateLanguage &&
    normalizeTemplateLanguageCode(input.footer) ===
      normalizeTemplateLanguageCode(input.templateLanguage)
  ) {
    return true;
  }

  return (
    isLikelyTemplateLanguageCode(input.footer) && shouldHideTemplateTitle(input)
  );
}

function sectionRows(section: OfficialDisplaySection): OfficialDisplayAction[] {
  return section.rows && section.rows.length > 0
    ? section.rows
    : (section.items ?? []);
}

function hasVisibleSectionContent(section: OfficialDisplaySection): boolean {
  return Boolean(
    readNonEmptyString(section.title) ||
    sectionRows(section).some((row) => !!getOfficialActionLabel(row))
  );
}

function hasVisibleCardContent(card: OfficialDisplayCard): boolean {
  return Boolean(
    readNonEmptyString(card.title) ||
    readNonEmptyString(card.body) ||
    readNonEmptyString(card.footer) ||
    readNonEmptyString(card.media?.url) ||
    readNonEmptyString(card.media?.link) ||
    getVisibleOfficialActions(card.actions).length > 0 ||
    getVisibleOfficialActions(card.items).length > 0
  );
}

function formatSubmittedValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function buildSubmittedEntries(
  data: Record<string, unknown> | null | undefined
): OfficialSubmittedEntry[] {
  if (!data || typeof data !== 'object') return [];

  return Object.entries(data)
    .map(([key, value]) => ({
      key,
      value: formatSubmittedValue(value),
    }))
    .filter((entry) => entry.value.length > 0);
}

function buildListOptionSections(
  display: OfficialDisplayMetadata,
  visibleSections: OfficialDisplaySection[]
): OfficialListOptionSection[] {
  if (display.kind !== 'list') return [];

  return visibleSections
    .map((section) => ({
      id: section.id,
      title: section.title,
      rows: getVisibleOfficialActions(sectionRows(section)),
    }))
    .filter((section) => section.rows.length > 0);
}

export function buildOfficialDisplayModel(
  display: OfficialDisplayMetadata,
  content: MessageContent
): OfficialDisplayModel {
  const templatePreview =
    display.kind === 'template' && content.official_template
      ? buildOfficialTemplatePreview(
          content.official_template,
          officialTemplateValuesFromTemplate(content.official_template)
        )
      : null;

  let title =
    readNonEmptyString(templatePreview?.header) ||
    readNonEmptyString(display.title);
  let body =
    readNonEmptyString(templatePreview?.body) ||
    readNonEmptyString(display.body);
  let footer =
    readNonEmptyString(templatePreview?.footer) ||
    readNonEmptyString(display.footer);

  if (display.kind === 'template') {
    const hideTitle = shouldHideTemplateTitle({
      title,
      body,
      footer,
      templateName: content.official_template?.name,
    });
    const hideFooter = shouldHideTemplateFooter({
      title,
      body,
      footer,
      templateName: content.official_template?.name,
      templateLanguage: content.official_template?.language,
    });

    if (hideTitle) title = null;
    if (hideFooter) footer = null;
  }

  if (body && title && body === title) {
    body = null;
  }

  const templateActions = (templatePreview?.buttons ?? []).map(
    (button, index) => ({
      id: `template-button-${index}`,
      title: button,
    })
  );
  const actions =
    display.actions && display.actions.length > 0
      ? display.actions
      : templateActions;
  const visibleActions = getVisibleOfficialActions(actions);
  const visibleItems = getVisibleOfficialActions(display.items);
  const visibleSections = (display.sections ?? []).filter(
    hasVisibleSectionContent
  );
  const visibleCards = (display.cards ?? []).filter(hasVisibleCardContent);
  const listOptionSections = buildListOptionSections(display, visibleSections);
  const actionLabel = readNonEmptyString(display.action_label);
  const collapsedActionLabel =
    display.kind === 'reply'
      ? null
      : display.kind === 'button'
        ? null
        : display.kind === 'cta_url' && visibleActions.length > 0
          ? null
          : actionLabel;
  const shouldShowInlineSections = !['list', 'product_list'].includes(
    display.kind
  );
  const shouldShowActionRows =
    !collapsedActionLabel && !['list', 'product_list'].includes(display.kind);
  const mediaUrl =
    readNonEmptyString(display.media?.url) ||
    readNonEmptyString(display.media?.link);
  const mediaType =
    readNonEmptyString(display.media?.type)?.toLowerCase() ?? null;

  return {
    display,
    title,
    body,
    footer,
    visibleActions,
    visibleItems,
    visibleSections,
    visibleCards,
    listOptionSections,
    submittedEntries: buildSubmittedEntries(display.submitted_data),
    collapsedActionLabel,
    actionLabel,
    mediaUrl,
    mediaType,
    isMediaVideo:
      mediaType === 'video' || mediaType?.includes('video') === true,
    shouldShowInlineSections,
    shouldShowActionRows,
  };
}
