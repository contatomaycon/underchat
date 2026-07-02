import type {
  OfficialOpeningTemplate,
  OfficialOpeningContextResponse,
} from '@core/schema/chat/officialOpeningContext/response.schema';
import type {
  IOfficialTemplateVariable,
  IOfficialTemplateVariableValue,
  OfficialTemplateVariableComponent,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';

export type OfficialTemplate = OfficialOpeningTemplate;
export type OfficialTemplateVariable = IOfficialTemplateVariable;
export type OfficialTemplateVariableValue = IOfficialTemplateVariableValue;

export interface OfficialTemplateOption {
  value: string;
  title: string;
  name: string;
  language: string;
  languageLabel: string;
  category: string | null;
  template: OfficialTemplate;
}

export interface OfficialTemplatePreview {
  header: string;
  body: string;
  footer: string;
  buttons: string[];
}

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
};

export const normalizeOfficialTemplateLanguageCode = (language: string) => {
  const normalized = language.trim().replace(/_/gu, '-');
  const [base, region] = normalized.split('-');

  if (!base || !region) {
    return normalized;
  }

  return `${base.toLowerCase()}-${region.toUpperCase()}`;
};

const normalizeAppLocale = (locale: string) => {
  const normalized = locale.trim().replace(/_/gu, '-');
  return LOCALE_MAP[normalized] ?? normalized;
};

const capitalize = (value: string) => {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
};

export const formatOfficialTemplateLanguage = (
  language: string,
  locale: string
) => {
  const normalizedLanguage = normalizeOfficialTemplateLanguageCode(language);
  const normalizedLocale = normalizeAppLocale(locale);

  try {
    const displayNames = new Intl.DisplayNames([normalizedLocale], {
      type: 'language',
    });

    return capitalize(displayNames.of(normalizedLanguage) ?? language);
  } catch {
    return language;
  }
};

export const buildOfficialTemplateKey = (
  template: Pick<OfficialTemplate, 'name' | 'language'>
) => `${template.name}::${template.language}`;

export const createOfficialTemplateOptions = (
  templates: OfficialTemplate[] | undefined,
  locale: string
): OfficialTemplateOption[] =>
  (templates ?? []).map((template) => ({
    value: buildOfficialTemplateKey(template),
    title: template.name,
    name: template.name,
    language: template.language,
    languageLabel: formatOfficialTemplateLanguage(template.language, locale),
    category: template.category ?? null,
    template,
  }));

const variableKey = (
  componentType: OfficialTemplateVariableComponent,
  index: number,
  buttonIndex?: number | null
) => {
  if (componentType === 'BUTTON') {
    return `${componentType}:${buttonIndex ?? 0}:${index}`;
  }

  return `${componentType}:${index}`;
};

export const createManualOfficialTemplateVariable = (
  index: number
): OfficialTemplateVariableValue => ({
  key: variableKey('BODY', index + 1),
  component_type: 'BODY',
  index: index + 1,
  button_index: null,
  value: '',
});

export const refreshOfficialTemplateVariableKey = <
  TVariable extends OfficialTemplateVariableValue,
>(
  variable: TVariable
): TVariable => ({
  ...variable,
  key: variableKey(
    variable.component_type,
    variable.index,
    variable.button_index ?? null
  ),
  button_index:
    variable.component_type === 'BUTTON' ? (variable.button_index ?? 0) : null,
});

export const createOfficialTemplateVariableValues = (
  variables: OfficialTemplateVariable[] | undefined,
  currentValues: OfficialTemplateVariableValue[] = []
): OfficialTemplateVariableValue[] => {
  const currentValueMap = new Map(
    currentValues.map((variable) => [variable.key, variable.value])
  );

  return (variables ?? []).map((variable) => ({
    key: variable.key,
    component_type: variable.component_type,
    index: variable.index,
    button_index: variable.button_index ?? null,
    value: currentValueMap.get(variable.key) ?? '',
  }));
};

export const buildOfficialTemplateVariablePayload = (
  variables: OfficialTemplateVariable[],
  values: Record<string, string>
): OfficialTemplateVariableValue[] =>
  variables.map((variable) => ({
    key: variable.key,
    component_type: variable.component_type,
    index: variable.index,
    button_index: variable.button_index ?? null,
    value: values[variable.key]?.trim() ?? '',
  }));

export const fillOfficialTemplateText = (input: {
  text: string | null | undefined;
  componentType: OfficialTemplateVariableComponent;
  variables: OfficialTemplateVariable[];
  values?: Record<string, string> | OfficialTemplateVariableValue[];
  buttonIndex?: number | null;
}) => {
  if (!input.text) {
    return '';
  }

  const valueMap = Array.isArray(input.values)
    ? new Map(input.values.map((variable) => [variable.key, variable.value]))
    : new Map(Object.entries(input.values ?? {}));

  return input.text.replace(/\{\{\s*(\d+)\s*\}\}/gu, (_, index: string) => {
    const key = variableKey(
      input.componentType,
      Number(index),
      input.buttonIndex
    );
    const value = valueMap.get(key)?.trim();
    const sample = input.variables.find(
      (variable) => variable.key === key
    )?.sample;

    return value || sample || `{{${index}}}`;
  });
};

export const buildOfficialTemplatePreview = (
  template: OfficialTemplate | null | undefined,
  values?: Record<string, string> | OfficialTemplateVariableValue[],
  variableOverride?: OfficialTemplateVariable[]
): OfficialTemplatePreview | null => {
  if (!template) {
    return null;
  }

  const variables = variableOverride ?? template.variables ?? [];
  const buttonComponent = template.components.find(
    (component) => component.type === 'BUTTONS'
  );
  const buttons =
    buttonComponent?.buttons
      ?.map((button, index) =>
        fillOfficialTemplateText({
          text: button.text ?? button.url,
          componentType: 'BUTTON',
          variables,
          values,
          buttonIndex: index,
        })
      )
      .filter((text) => text.trim()) ??
    template.preview.buttons?.filter((text) => text.trim()) ??
    [];

  return {
    header: fillOfficialTemplateText({
      text: template.preview.header,
      componentType: 'HEADER',
      variables,
      values,
    }),
    body: fillOfficialTemplateText({
      text: template.preview.body,
      componentType: 'BODY',
      variables,
      values,
    }),
    footer: fillOfficialTemplateText({
      text: template.preview.footer,
      componentType: 'FOOTER',
      variables,
      values,
    }),
    buttons,
  };
};

export const findOfficialTemplate = (
  templates: OfficialOpeningContextResponse['templates'] | undefined,
  key: string | null
) =>
  (templates ?? []).find(
    (template) => buildOfficialTemplateKey(template) === key
  ) ?? null;
