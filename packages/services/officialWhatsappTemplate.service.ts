import { injectable } from 'tsyringe';
import {
  IOfficialTemplateButton,
  IOfficialTemplateComponent,
  IOfficialTemplateVariable,
  IOfficialWhatsappTemplate,
  IOfficialWhatsappTemplateMessage,
  OfficialTemplateParameterFormat,
  OfficialTemplateVariableComponent,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';
import {
  MetaTemplateButton,
  MetaTemplateComponent,
  MetaWhatsappApprovedTemplate,
  MetaWhatsappTemplateMessageComponent,
} from './metaWhatsappEmbedded.service';
import { normalizeOfficialTemplateVariableValue } from '@core/common/functions/normalizeOfficialTemplateVariableValue';
import {
  hasExactOfficialWhatsappTemplatePlaceholderBoundaries,
  inferOfficialWhatsappTemplateParameterFormat,
  inspectOfficialWhatsappTemplateTextSyntax,
  META_TEMPLATE_PLACEHOLDER_PATTERN,
} from '@core/common/functions/officialWhatsappTemplateSyntax';

type VariableExampleMap = Record<string, string | null>;

interface TemplateVariableSyntaxInput {
  parameter_format?: OfficialTemplateParameterFormat;
  components?: Array<{
    text?: string | null;
    buttons?: Array<{ url?: string | null }> | null;
  }>;
  preview?: {
    header?: string | null;
    body?: string | null;
    footer?: string | null;
  };
}

@injectable()
export class OfficialWhatsappTemplateService {
  normalizeTemplates(
    templates: MetaWhatsappApprovedTemplate[]
  ): IOfficialWhatsappTemplate[] {
    return templates.flatMap((template) => {
      try {
        return [this.normalizeTemplate(template)];
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'official_template_variable_syntax_invalid'
        ) {
          console.warn(
            '[OfficialWhatsappTemplate] Ignoring template with invalid Meta variable syntax',
            {
              template_name: template.name,
              language: template.language,
            }
          );
          return [];
        }
        throw error;
      }
    });
  }

  findTemplate(
    templates: IOfficialWhatsappTemplate[],
    input: Pick<IOfficialWhatsappTemplateMessage, 'name' | 'language'>
  ): IOfficialWhatsappTemplate | null {
    const normalizedName = input.name.trim();
    const normalizedLanguage = input.language.trim();

    return (
      templates.find(
        (template) =>
          template.name === normalizedName &&
          template.language === normalizedLanguage &&
          template.status === 'APPROVED'
      ) ?? null
    );
  }

  buildPreviewText(
    template: IOfficialWhatsappTemplate,
    values: IOfficialWhatsappTemplateMessage['variables'] = []
  ): string {
    this.assertTemplateVariableSyntax(template);
    const valueMap = new Map<string, string>();
    for (const item of values ?? []) {
      const value = this.normalizeVariableValue(item.value);
      valueMap.set(item.key, value);
      valueMap.set(
        this.variableKey(
          item.component_type,
          item.index,
          item.button_index ?? null,
          item.parameter_name ?? null
        ),
        value
      );
    }
    const fillText = (
      text: string | null | undefined,
      componentType: OfficialTemplateVariableComponent,
      buttonIndex?: number | null
    ): string | null => {
      if (!text) {
        return null;
      }

      return text.replace(
        META_TEMPLATE_PLACEHOLDER_PATTERN,
        (placeholder, token: string, offset: number, source: string) => {
          if (
            !hasExactOfficialWhatsappTemplatePlaceholderBoundaries(
              source,
              offset,
              placeholder.length
            )
          ) {
            return placeholder;
          }
          const numericIndex = Number(token);
          const key = this.variableKey(
            componentType,
            Number.isInteger(numericIndex) ? numericIndex : 0,
            buttonIndex,
            Number.isInteger(numericIndex) ? null : token
          );
          const value = valueMap.get(key);
          return typeof value === 'string' && value.trim()
            ? value.trim()
            : placeholder;
        }
      );
    };

    const header = fillText(template.preview.header, 'HEADER');
    const body = fillText(template.preview.body, 'BODY');
    const footer = fillText(template.preview.footer, 'FOOTER');
    const parts = [header, body, footer].filter(
      (part): part is string => !!part?.trim()
    );

    return parts.join('\n\n') || template.name;
  }

  validateVariableValues(input: {
    template: IOfficialWhatsappTemplate;
    values?: IOfficialWhatsappTemplateMessage['variables'];
  }): IOfficialWhatsappTemplateMessage['variables'] {
    this.assertTemplateVariableSyntax(input.template);
    const values = input.values ?? [];
    const normalizedValues: NonNullable<
      IOfficialWhatsappTemplateMessage['variables']
    > = [];

    if (input.template.variables.length === 0) {
      if (input.template.components.length > 0 && values.length > 0) {
        throw new Error('official_template_variables_invalid');
      }
      for (const item of values) {
        const value = this.normalizeVariableValue(item.value);
        const parameterName = this.normalizeParameterName(item.parameter_name);

        normalizedValues.push({
          key: this.variableKey(
            item.component_type,
            item.index,
            item.button_index ?? null,
            parameterName
          ),
          component_type: item.component_type,
          index: item.index,
          ...(parameterName ? { parameter_name: parameterName } : {}),
          button_index: item.button_index ?? null,
          value,
        });
      }

      return normalizedValues;
    }

    const consumedIndexes = new Set<number>();
    for (const variable of input.template.variables) {
      const matchingIndexes = values.flatMap((item, index) =>
        this.matchesVariable(variable, item) ? [index] : []
      );
      const availableIndexes = matchingIndexes.filter(
        (index) => !consumedIndexes.has(index)
      );
      if (availableIndexes.length !== 1) {
        throw new Error('official_template_variables_required');
      }
      const valueIndex = availableIndexes[0] as number;
      consumedIndexes.add(valueIndex);
      const value = this.normalizeVariableValue(values[valueIndex]?.value);

      normalizedValues.push({
        key: variable.key,
        component_type: variable.component_type,
        index: variable.index,
        ...(variable.parameter_name
          ? { parameter_name: variable.parameter_name }
          : {}),
        button_index: variable.button_index ?? null,
        value,
      });
    }

    if (consumedIndexes.size !== values.length) {
      throw new Error('official_template_variables_invalid');
    }

    return normalizedValues;
  }

  normalizeVariableValue(value: unknown): string {
    return normalizeOfficialTemplateVariableValue(value);
  }

  buildMetaComponents(
    values: IOfficialWhatsappTemplateMessage['variables'] = [],
    templateComponents: IOfficialWhatsappTemplateMessage['components'] = []
  ): MetaWhatsappTemplateMessageComponent[] {
    const grouped = new Map<string, NonNullable<typeof values>>();

    for (const variable of values ?? []) {
      if (
        !this.isCanonicalTextComponentVariable(variable, templateComponents)
      ) {
        continue;
      }
      const groupKey =
        variable.component_type === 'BUTTON'
          ? `${variable.component_type}:${variable.button_index ?? 0}`
          : variable.component_type;
      const current = grouped.get(groupKey) ?? [];
      current.push(variable);
      grouped.set(groupKey, current);
    }

    const components: MetaWhatsappTemplateMessageComponent[] = [];

    for (const [groupKey, variables] of grouped.entries()) {
      const sorted = [...variables].sort((a, b) => a.index - b.index);
      const parameters = sorted.map((variable) => {
        const parameterName = this.normalizeParameterName(
          variable.parameter_name
        );
        return {
          type: 'text' as const,
          text: this.normalizeVariableValue(variable.value),
          ...(parameterName ? { parameter_name: parameterName } : {}),
        };
      });

      if (groupKey.startsWith('BUTTON:')) {
        const buttonIndex = groupKey.split(':')[1] ?? '0';
        components.push({
          type: 'button',
          sub_type: 'url',
          index: buttonIndex,
          parameters,
        });
        continue;
      }

      if (groupKey === 'HEADER') {
        components.push({ type: 'header', parameters });
        continue;
      }

      if (groupKey === 'BODY') {
        components.push({ type: 'body', parameters });
      }
    }

    for (const component of templateComponents ?? []) {
      if (component.type.toUpperCase() !== 'BUTTONS') {
        continue;
      }

      for (const [buttonIndex, button] of (component.buttons ?? []).entries()) {
        if (button.type.toUpperCase() !== 'QUICK_REPLY') {
          continue;
        }

        const payload = button.text?.trim() || `quick_reply_${buttonIndex}`;
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(buttonIndex),
          parameters: [{ type: 'payload', payload }],
        });
      }
    }

    return components;
  }

  private isCanonicalTextComponentVariable(
    variable: NonNullable<
      IOfficialWhatsappTemplateMessage['variables']
    >[number],
    templateComponents: IOfficialWhatsappTemplateMessage['components']
  ): boolean {
    if (
      variable.component_type !== 'BODY' &&
      variable.component_type !== 'HEADER'
    ) {
      return true;
    }

    // Older queue snapshots can legitimately lack component metadata. Keep
    // their existing behavior because there is no authoritative text against
    // which to validate the runtime parameters.
    if (!templateComponents?.length) {
      return true;
    }

    const parameterName = this.normalizeParameterName(variable.parameter_name);

    return templateComponents.some((component) => {
      if (component.type.toUpperCase() !== variable.component_type) {
        return false;
      }

      const text = component.text ?? '';
      for (const match of text.matchAll(META_TEMPLATE_PLACEHOLDER_PATTERN)) {
        if (
          hasExactOfficialWhatsappTemplatePlaceholderBoundaries(
            text,
            match.index,
            match[0].length
          )
        ) {
          const token = match[1] ?? '';
          const isPositional = /^[1-9]\d*$/u.test(token);
          const matchesVariable = parameterName
            ? !isPositional && token === parameterName
            : isPositional && Number(token) === variable.index;
          if (matchesVariable) {
            return true;
          }
        }
      }

      return false;
    });
  }

  private normalizeTemplate(
    template: MetaWhatsappApprovedTemplate
  ): IOfficialWhatsappTemplate {
    const parameterFormat = this.resolveParameterFormat(template);
    this.assertTemplateVariableSyntax({
      parameter_format: parameterFormat,
      components: template.components,
      preview: {},
    });
    const variables: IOfficialTemplateVariable[] = [];
    const components = template.components.map((component) =>
      this.normalizeComponent(component, variables, parameterFormat)
    );
    const preview = this.buildPreview(components);

    return {
      id: template.id,
      name: template.name,
      language: template.language,
      status: 'APPROVED',
      parameter_format: parameterFormat,
      category: template.category,
      components,
      variables,
      preview,
    };
  }

  private normalizeComponent(
    component: MetaTemplateComponent,
    variables: IOfficialTemplateVariable[],
    parameterFormat: OfficialTemplateParameterFormat
  ): IOfficialTemplateComponent {
    const componentType = (component.type ?? '').toUpperCase();
    const normalized: IOfficialTemplateComponent = {
      type: componentType,
      format: component.format ?? null,
      text: component.text ?? null,
      example: component.example ?? null,
      variables: [],
    };

    if (
      componentType === 'HEADER' ||
      componentType === 'BODY' ||
      componentType === 'FOOTER'
    ) {
      const componentVariables = this.extractTextVariables({
        text: component.text,
        componentType,
        parameterFormat,
        examples: this.extractExamples(component, parameterFormat),
      });
      normalized.variables = componentVariables;
      variables.push(...componentVariables);
    }

    if (componentType === 'BUTTONS') {
      normalized.buttons = (component.buttons ?? []).map((button, index) =>
        this.normalizeButton(button, index, variables, parameterFormat)
      );
    }

    return normalized;
  }

  private normalizeButton(
    button: MetaTemplateButton,
    buttonIndex: number,
    variables: IOfficialTemplateVariable[],
    parameterFormat: OfficialTemplateParameterFormat
  ): IOfficialTemplateButton {
    const buttonVariables = this.extractTextVariables({
      text: button.url,
      componentType: 'BUTTON',
      buttonIndex,
      parameterFormat,
      examples: this.examplesFromArray(button.example),
    });
    variables.push(...buttonVariables);

    return {
      type: (button.type ?? '').toUpperCase(),
      text: button.text ?? null,
      url: button.url ?? null,
      phone_number: button.phone_number ?? null,
      example: button.example ?? null,
      variables: buttonVariables,
    };
  }

  private buildPreview(components: IOfficialTemplateComponent[]): {
    header?: string | null;
    body?: string | null;
    footer?: string | null;
    buttons?: string[];
  } {
    const findText = (type: string): string | null =>
      components.find((component) => component.type === type)?.text ?? null;
    const buttons =
      components
        .find((component) => component.type === 'BUTTONS')
        ?.buttons?.map((button) => button.text)
        .filter((text): text is string => !!text?.trim()) ?? [];

    return {
      header: findText('HEADER'),
      body: findText('BODY'),
      footer: findText('FOOTER'),
      buttons,
    };
  }

  private extractTextVariables(input: {
    text?: string | null;
    componentType: OfficialTemplateVariableComponent;
    buttonIndex?: number | null;
    parameterFormat: OfficialTemplateParameterFormat;
    examples?: VariableExampleMap;
  }): IOfficialTemplateVariable[] {
    if (!input.text) {
      return [];
    }

    const found = new Map<string, IOfficialTemplateVariable>();
    const matches = input.text.matchAll(META_TEMPLATE_PLACEHOLDER_PATTERN);

    for (const match of matches) {
      if (
        !hasExactOfficialWhatsappTemplatePlaceholderBoundaries(
          input.text,
          match.index,
          match[0].length
        )
      ) {
        continue;
      }
      const token = match[1] ?? '';
      const isPositional = /^\d+$/u.test(token);
      const tokenFormat: OfficialTemplateParameterFormat = isPositional
        ? 'POSITIONAL'
        : 'NAMED';
      if (
        !token ||
        (input.componentType === 'BUTTON'
          ? tokenFormat !== 'POSITIONAL'
          : tokenFormat !== input.parameterFormat) ||
        found.has(token)
      ) {
        continue;
      }

      const index =
        tokenFormat === 'POSITIONAL' ? Number(token) : found.size + 1;
      if (!Number.isSafeInteger(index) || index <= 0) {
        continue;
      }
      const parameterName = tokenFormat === 'NAMED' ? token : null;

      found.set(token, {
        key: this.variableKey(
          input.componentType,
          index,
          input.buttonIndex,
          parameterName
        ),
        component_type: input.componentType,
        index,
        ...(parameterName ? { parameter_name: parameterName } : {}),
        button_index: input.buttonIndex ?? null,
        sample: input.examples?.[parameterName ?? String(index)] ?? null,
      });
    }

    return [...found.values()].sort((a, b) => a.index - b.index);
  }

  private extractExamples(
    component: MetaTemplateComponent,
    parameterFormat: OfficialTemplateParameterFormat
  ): VariableExampleMap {
    const example = component.example ?? {};
    if (parameterFormat === 'NAMED') {
      const namedValues =
        example.body_text_named_params ??
        example.header_text_named_params ??
        example.footer_text_named_params;
      if (!Array.isArray(namedValues)) {
        return {};
      }

      const entries = Array.isArray(namedValues[0])
        ? namedValues[0]
        : namedValues;
      return entries.reduce<VariableExampleMap>((acc, value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return acc;
        }
        const record = value as Record<string, unknown>;
        const parameterName = this.normalizeParameterName(
          record.param_name ?? record.parameter_name
        );
        if (parameterName) {
          acc[parameterName] =
            record.example === null || record.example === undefined
              ? null
              : String(record.example);
        }
        return acc;
      }, {});
    }

    const positionalExamples = this.firstArray(
      example.body_text ?? example.header_text ?? example.footer_text
    );

    return this.examplesFromArray(positionalExamples);
  }

  private firstArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const first = value[0];
    if (Array.isArray(first)) {
      return first.map((item) => String(item));
    }

    return value.map((item) => String(item));
  }

  private examplesFromArray(values: unknown): VariableExampleMap {
    if (!Array.isArray(values)) {
      return {};
    }

    return values.reduce<VariableExampleMap>((acc, value, index) => {
      acc[String(index + 1)] = value === null ? null : String(value);
      return acc;
    }, {});
  }

  private variableKey(
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

  private normalizeParameterName(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private matchesVariable(
    expected: IOfficialTemplateVariable,
    actual: NonNullable<IOfficialWhatsappTemplateMessage['variables']>[number]
  ): boolean {
    if (actual.key === expected.key) {
      return true;
    }

    if (
      actual.component_type !== expected.component_type ||
      (actual.button_index ?? null) !== (expected.button_index ?? null)
    ) {
      return false;
    }

    const expectedName = this.normalizeParameterName(expected.parameter_name);
    const actualName = this.normalizeParameterName(actual.parameter_name);
    if (expectedName && actualName) {
      return expectedName === actualName;
    }

    return actual.index === expected.index;
  }

  private resolveParameterFormat(
    template: MetaWhatsappApprovedTemplate
  ): OfficialTemplateParameterFormat {
    if (
      template.parameter_format === 'NAMED' ||
      template.parameter_format === 'POSITIONAL'
    ) {
      return template.parameter_format;
    }

    const texts = template.components.flatMap((component) => [
      component.text,
      ...(component.buttons?.map((button) => button.url) ?? []),
    ]);
    return inferOfficialWhatsappTemplateParameterFormat(texts);
  }

  public assertTemplateVariableSyntax(
    template: TemplateVariableSyntaxInput
  ): void {
    const componentTexts = (template.components ?? []).map(
      (component) => component.text
    );
    const buttonUrls = (template.components ?? []).flatMap(
      (component) => component.buttons?.map((button) => button.url) ?? []
    );
    const preview = template.preview ?? {};
    const previewTexts = [preview.header, preview.body, preview.footer];
    const texts = [...componentTexts, ...previewTexts];
    const parameterFormat =
      template.parameter_format ??
      inferOfficialWhatsappTemplateParameterFormat(texts);

    if (
      texts.some(
        (text) =>
          !inspectOfficialWhatsappTemplateTextSyntax(text, parameterFormat)
            .valid
      ) ||
      buttonUrls.some(
        (url) =>
          !inspectOfficialWhatsappTemplateTextSyntax(url, 'POSITIONAL').valid
      )
    ) {
      throw new Error('official_template_variable_syntax_invalid');
    }
  }
}
