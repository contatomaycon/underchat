import type {
  OfficialOpeningContextResponse,
  OfficialTemplate,
  OfficialTemplateMessageRequest,
  OfficialTemplatePreview,
  OfficialTemplateVariable,
  OfficialTemplateVariableComponent,
  OfficialTemplateVariableValue,
} from '../types/chat';

export interface OfficialTemplateOption {
  value: string;
  label: string;
  name: string;
  language: string;
  languageLabel: string;
  category: string | null;
  template: OfficialTemplate;
}

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
};

export function normalizeOfficialTemplateLanguageCode(
  language: string
): string {
  const normalized = language.trim().replace(/_/g, '-');
  const [base, region] = normalized.split('-');

  if (!base || !region) {
    return normalized;
  }

  return `${base.toLowerCase()}-${region.toUpperCase()}`;
}

function normalizeAppLocale(locale: string): string {
  const normalized = locale.trim().replace(/_/g, '-');
  return LOCALE_MAP[normalized] ?? normalized;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

export function formatOfficialTemplateLanguage(
  language: string,
  locale: string
): string {
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
}

export function buildOfficialTemplateKey(
  template: Pick<OfficialTemplate, 'name' | 'language'>
): string {
  return `${template.name}::${template.language}`;
}

export function createOfficialTemplateOptions(
  templates: OfficialTemplate[] | undefined,
  locale: string
): OfficialTemplateOption[] {
  return (templates ?? []).map((template) => ({
    value: buildOfficialTemplateKey(template),
    label: template.name,
    name: template.name,
    language: template.language,
    languageLabel: formatOfficialTemplateLanguage(template.language, locale),
    category: template.category ?? null,
    template,
  }));
}

function variableKey(
  componentType: OfficialTemplateVariableComponent,
  index: number,
  buttonIndex?: number | null,
  parameterName?: string | null
): string {
  const identifier = parameterName?.trim() || String(index);

  if (componentType === 'BUTTON') {
    return `${componentType}:${buttonIndex ?? 0}:${identifier}`;
  }

  return `${componentType}:${identifier}`;
}

function normalizeOfficialTemplateVariableValue(
  value: string | number
): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  return value.trim();
}

export function createManualOfficialTemplateVariable(
  index: number
): OfficialTemplateVariableValue {
  return {
    key: variableKey('BODY', index + 1),
    component_type: 'BODY',
    index: index + 1,
    button_index: null,
    value: '',
  };
}

export function refreshOfficialTemplateVariableKey<
  TVariable extends OfficialTemplateVariableValue,
>(variable: TVariable): TVariable {
  return {
    ...variable,
    key: variableKey(
      variable.component_type,
      variable.index,
      variable.button_index ?? null,
      variable.parameter_name ?? null
    ),
    button_index:
      variable.component_type === 'BUTTON'
        ? (variable.button_index ?? 0)
        : null,
  };
}

export function createOfficialTemplateVariableValues(
  variables: OfficialTemplateVariable[] | undefined,
  currentValues: OfficialTemplateVariableValue[] = []
): OfficialTemplateVariableValue[] {
  const currentValueMap = new Map(
    currentValues.map((variable) => [variable.key, variable.value])
  );

  const currentIdentityMap = new Map(
    currentValues.map((variable) => [
      variableKey(
        variable.component_type,
        variable.index,
        variable.button_index ?? null,
        variable.parameter_name ?? null
      ),
      variable.value,
    ])
  );

  return (variables ?? []).map((variable) => ({
    key: variable.key,
    component_type: variable.component_type,
    index: variable.index,
    parameter_name: variable.parameter_name ?? null,
    button_index: variable.button_index ?? null,
    value:
      currentValueMap.get(variable.key) ??
      currentIdentityMap.get(
        variableKey(
          variable.component_type,
          variable.index,
          variable.button_index ?? null,
          variable.parameter_name ?? null
        )
      ) ??
      '',
  }));
}

export function fillOfficialTemplateText(input: {
  text: string | null | undefined;
  componentType: OfficialTemplateVariableComponent;
  variables: OfficialTemplateVariable[];
  values?: OfficialTemplateVariableValue[];
  buttonIndex?: number | null;
}): string {
  if (!input.text) {
    return '';
  }

  const valueMap = new Map(
    (input.values ?? []).map((variable) => [variable.key, variable.value])
  );

  return input.text.replace(
    /\{\{([1-9]\d*|[a-z][a-z0-9_]*)\}\}/g,
    (placeholder, identifier: string, offset: number, source: string) => {
      if (
        source[offset - 1] === '{' ||
        source[offset + placeholder.length] === '}'
      ) {
        return placeholder;
      }
      const isPositional = /^\d+$/.test(identifier);
      const matchedVariable = input.variables.find((variable) => {
        if (variable.component_type !== input.componentType) return false;
        if (
          input.componentType === 'BUTTON' &&
          (variable.button_index ?? 0) !== (input.buttonIndex ?? 0)
        ) {
          return false;
        }

        return isPositional
          ? !variable.parameter_name && variable.index === Number(identifier)
          : variable.parameter_name === identifier;
      });
      const key =
        matchedVariable?.key ??
        variableKey(
          input.componentType,
          isPositional ? Number(identifier) : 0,
          input.buttonIndex,
          isPositional ? null : identifier
        );
      const rawValue = valueMap.get(key);
      const value =
        rawValue === undefined
          ? ''
          : normalizeOfficialTemplateVariableValue(rawValue);
      const sample = matchedVariable?.sample;

      return value || sample || `{{${identifier}}}`;
    }
  );
}

export function buildOfficialTemplatePreview(
  template: OfficialTemplate | null | undefined,
  values?: OfficialTemplateVariableValue[],
  variableOverride?: OfficialTemplateVariable[]
): OfficialTemplatePreview | null {
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
}

export function findOfficialTemplate(
  templates: OfficialOpeningContextResponse['templates'] | undefined,
  key: string | null
): OfficialTemplate | null {
  return (
    (templates ?? []).find(
      (template) => buildOfficialTemplateKey(template) === key
    ) ?? null
  );
}

export function formatOfficialTemplateVariableLabel(
  variable: Pick<
    OfficialTemplateVariable,
    'component_type' | 'index' | 'button_index' | 'parameter_name'
  >
): string {
  const identifier = variable.parameter_name?.trim() || variable.index;

  if (variable.component_type === 'BUTTON') {
    return `BUTTON ${variable.button_index ?? 0} {{${identifier}}}`;
  }

  return `${variable.component_type} {{${identifier}}}`;
}

export function areOfficialTemplateVariablesValid(
  template: OfficialTemplate | null | undefined,
  values: OfficialTemplateVariableValue[]
): boolean {
  if (!template) return false;

  if (template.variables.length === 0) {
    return values.every(
      (variable) =>
        normalizeOfficialTemplateVariableValue(variable.value).length > 0
    );
  }

  const valueMap = new Map(
    values.map((variable) => [
      variable.key,
      normalizeOfficialTemplateVariableValue(variable.value),
    ])
  );

  return template.variables.every((variable) => {
    const value = valueMap.get(variable.key);
    return typeof value === 'string' && value.length > 0;
  });
}

export function buildOfficialTemplateRequest(
  template: OfficialTemplate,
  values: OfficialTemplateVariableValue[]
): OfficialTemplateMessageRequest {
  const variables = values
    .map(refreshOfficialTemplateVariableKey)
    .map((variable) => ({
      ...variable,
      value: normalizeOfficialTemplateVariableValue(variable.value),
    }))
    .filter((variable) => variable.value.length > 0);

  return {
    name: template.name,
    language: template.language,
    variables: variables.length > 0 ? variables : undefined,
  };
}
