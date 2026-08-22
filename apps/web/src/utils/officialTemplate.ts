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
export type OfficialTemplateParameterFormat = 'POSITIONAL' | 'NAMED';
export type OfficialTemplateVariable = IOfficialTemplateVariable & {
  parameter_name?: string | null;
};
export type OfficialTemplateVariableValue = Omit<
  IOfficialTemplateVariableValue,
  'value'
> & {
  parameter_name?: string | null;
  value: string;
};

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

type OfficialTemplateVariableIdentifier = string | number;

const normalizeParameterName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const variableIdentifier = (
  variable: Pick<OfficialTemplateVariable, 'index' | 'parameter_name'>
): OfficialTemplateVariableIdentifier =>
  normalizeParameterName(variable.parameter_name) ?? variable.index;

const variableKey = (
  componentType: OfficialTemplateVariableComponent,
  identifier: OfficialTemplateVariableIdentifier,
  buttonIndex?: number | null
) => {
  if (componentType === 'BUTTON') {
    return `${componentType}:${buttonIndex ?? 0}:${identifier}`;
  }

  return `${componentType}:${identifier}`;
};

export const formatOfficialTemplateVariableToken = (
  variable: Pick<OfficialTemplateVariable, 'index' | 'parameter_name'>
) => `{{${variableIdentifier(variable)}}}`;

export const formatOfficialTemplateVariableLabel = (
  variable: Pick<
    OfficialTemplateVariable,
    'component_type' | 'index' | 'parameter_name'
  >
) =>
  `${variable.component_type} ${formatOfficialTemplateVariableToken(variable)}`;

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
    variableIdentifier(variable),
    variable.button_index ?? null
  ),
  parameter_name: normalizeParameterName(variable.parameter_name),
  button_index:
    variable.component_type === 'BUTTON' ? (variable.button_index ?? 0) : null,
});

export const normalizeEditableOfficialTemplateVariables = (
  variables?: unknown[]
): OfficialTemplateVariableValue[] => {
  const rawVariables = Array.isArray(variables) ? variables : [];

  return rawVariables.map((variable, index) => {
    if (!variable || typeof variable !== 'object' || Array.isArray(variable)) {
      return createManualOfficialTemplateVariable(index);
    }

    const record = variable as Record<string, unknown>;
    const componentType: OfficialTemplateVariableComponent =
      record.component_type === 'HEADER' ||
      record.component_type === 'FOOTER' ||
      record.component_type === 'BUTTON'
        ? record.component_type
        : 'BODY';
    const variableIndex =
      typeof record.index === 'number' &&
      Number.isFinite(record.index) &&
      record.index > 0
        ? record.index
        : index + 1;
    const rawValue = record.value;

    return refreshOfficialTemplateVariableKey({
      key:
        typeof record.key === 'string'
          ? record.key
          : variableKey(componentType, variableIndex),
      component_type: componentType,
      index: variableIndex,
      parameter_name: normalizeParameterName(record.parameter_name),
      button_index:
        typeof record.button_index === 'number' &&
        Number.isFinite(record.button_index)
          ? record.button_index
          : null,
      value:
        typeof rawValue === 'number' && Number.isFinite(rawValue)
          ? String(rawValue)
          : typeof rawValue === 'string'
            ? rawValue
            : '',
    });
  });
};

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
    parameter_name: normalizeParameterName(variable.parameter_name),
    button_index: variable.button_index ?? null,
    value: currentValueMap.get(variable.key) ?? '',
  }));
};

export const createOfficialTemplateVariableValueRecord = (
  variables: OfficialTemplateVariable[] | undefined,
  currentValues: Readonly<Record<string, string | number | undefined>> = {}
): Record<string, string> =>
  Object.fromEntries(
    (variables ?? []).map((variable) => {
      const currentValue = currentValues[variable.key];

      return [
        variable.key,
        typeof currentValue === 'number'
          ? String(currentValue)
          : (currentValue ?? ''),
      ];
    })
  );

export const buildOfficialTemplateVariablePayload = (
  variables: OfficialTemplateVariable[],
  values: Record<string, string | number>
): OfficialTemplateVariableValue[] =>
  variables.map((variable) => {
    const rawValue = values[variable.key];
    return {
      key: variable.key,
      component_type: variable.component_type,
      index: variable.index,
      parameter_name: normalizeParameterName(variable.parameter_name),
      button_index: variable.button_index ?? null,
      value:
        typeof rawValue === 'number'
          ? String(rawValue)
          : (rawValue?.trim() ?? ''),
    };
  });

const findVariableForPlaceholder = (input: {
  token: string;
  componentType: OfficialTemplateVariableComponent;
  variables: OfficialTemplateVariable[];
  buttonIndex?: number | null;
}) => {
  const parameterName = /^\d+$/u.test(input.token) ? null : input.token;
  const index = parameterName ? null : Number(input.token);

  return input.variables.find((variable) => {
    if (variable.component_type !== input.componentType) {
      return false;
    }
    if (
      input.componentType === 'BUTTON' &&
      (variable.button_index ?? 0) !== (input.buttonIndex ?? 0)
    ) {
      return false;
    }

    return parameterName
      ? normalizeParameterName(variable.parameter_name) === parameterName
      : !normalizeParameterName(variable.parameter_name) &&
          variable.index === index;
  });
};

export const fillOfficialTemplateText = (input: {
  text: string | null | undefined;
  componentType: OfficialTemplateVariableComponent;
  variables: OfficialTemplateVariable[];
  values?:
    | Record<string, string | number>
    | Array<OfficialTemplateVariableValue & { value: string | number }>;
  buttonIndex?: number | null;
}) => {
  if (!input.text) {
    return '';
  }

  const valueMap = Array.isArray(input.values)
    ? new Map(input.values.map((variable) => [variable.key, variable.value]))
    : new Map(Object.entries(input.values ?? {}));

  return input.text.replace(
    /\{\{([1-9]\d*|[a-z][a-z0-9_]*)\}\}/gu,
    (placeholder, token: string, offset: number, source: string) => {
      if (
        source[offset - 1] === '{' ||
        source[offset + placeholder.length] === '}'
      ) {
        return placeholder;
      }
      const variable = findVariableForPlaceholder({
        token,
        componentType: input.componentType,
        variables: input.variables,
        buttonIndex: input.buttonIndex,
      });
      const key =
        variable?.key ??
        variableKey(input.componentType, token, input.buttonIndex);
      const rawValue = valueMap.get(key);
      const value =
        typeof rawValue === 'number' ? String(rawValue) : rawValue?.trim();
      const sample = variable?.sample;

      return value || sample || `{{${token}}}`;
    }
  );
};

export const containsUnderchatVariableTag = (value: unknown): boolean =>
  typeof value === 'string' &&
  /\{\{\s*[A-Za-z_][\w]*(?:\.[\w]+)*\s*\}\}/u.test(value);

export const buildOfficialTemplatePreview = (
  template: OfficialTemplate | null | undefined,
  values?:
    | Record<string, string | number>
    | Array<OfficialTemplateVariableValue & { value: string | number }>,
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
