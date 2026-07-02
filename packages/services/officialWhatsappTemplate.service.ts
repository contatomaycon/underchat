import { injectable } from 'tsyringe';
import {
  IOfficialTemplateButton,
  IOfficialTemplateComponent,
  IOfficialTemplateVariable,
  IOfficialWhatsappTemplate,
  IOfficialWhatsappTemplateMessage,
  OfficialTemplateVariableComponent,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';
import {
  MetaTemplateButton,
  MetaTemplateComponent,
  MetaWhatsappApprovedTemplate,
  MetaWhatsappTemplateMessageComponent,
} from './metaWhatsappEmbedded.service';

type VariableExampleMap = Record<string, string | null>;

@injectable()
export class OfficialWhatsappTemplateService {
  normalizeTemplates(
    templates: MetaWhatsappApprovedTemplate[]
  ): IOfficialWhatsappTemplate[] {
    return templates.map((template) => this.normalizeTemplate(template));
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
    const valueMap = new Map(values?.map((item) => [item.key, item.value]));
    const fillText = (
      text: string | null | undefined,
      componentType: OfficialTemplateVariableComponent,
      buttonIndex?: number | null
    ): string | null => {
      if (!text) {
        return null;
      }

      return text.replace(/\{\{\s*(\d+)\s*\}\}/gu, (_, index: string) => {
        const key = this.variableKey(componentType, Number(index), buttonIndex);
        return valueMap.get(key)?.trim() || `{{${index}}}`;
      });
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
    const values = input.values ?? [];
    const valueMap = new Map(values.map((item) => [item.key, item]));
    const normalizedValues: NonNullable<
      IOfficialWhatsappTemplateMessage['variables']
    > = [];

    if (input.template.variables.length === 0) {
      for (const item of values) {
        const value = item.value?.trim();
        if (!value) {
          continue;
        }

        normalizedValues.push({
          key: this.variableKey(
            item.component_type,
            item.index,
            item.button_index ?? null
          ),
          component_type: item.component_type,
          index: item.index,
          button_index: item.button_index ?? null,
          value,
        });
      }

      return normalizedValues;
    }

    for (const variable of input.template.variables) {
      const value = valueMap.get(variable.key)?.value?.trim();
      if (!value) {
        throw new Error('official_template_variables_required');
      }

      normalizedValues.push({
        key: variable.key,
        component_type: variable.component_type,
        index: variable.index,
        button_index: variable.button_index ?? null,
        value,
      });
    }

    return normalizedValues;
  }

  buildMetaComponents(
    values: IOfficialWhatsappTemplateMessage['variables'] = []
  ): MetaWhatsappTemplateMessageComponent[] {
    const grouped = new Map<string, NonNullable<typeof values>>();

    for (const variable of values ?? []) {
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
      const parameters = sorted.map((variable) => ({
        type: 'text' as const,
        text: variable.value,
      }));

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

    return components;
  }

  private normalizeTemplate(
    template: MetaWhatsappApprovedTemplate
  ): IOfficialWhatsappTemplate {
    const variables: IOfficialTemplateVariable[] = [];
    const components = template.components.map((component) =>
      this.normalizeComponent(component, variables)
    );
    const preview = this.buildPreview(components);

    return {
      id: template.id,
      name: template.name,
      language: template.language,
      status: 'APPROVED',
      category: template.category,
      components,
      variables,
      preview,
    };
  }

  private normalizeComponent(
    component: MetaTemplateComponent,
    variables: IOfficialTemplateVariable[]
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
        examples: this.extractExamples(component),
      });
      normalized.variables = componentVariables;
      variables.push(...componentVariables);
    }

    if (componentType === 'BUTTONS') {
      normalized.buttons = (component.buttons ?? []).map((button, index) =>
        this.normalizeButton(button, index, variables)
      );
    }

    return normalized;
  }

  private normalizeButton(
    button: MetaTemplateButton,
    buttonIndex: number,
    variables: IOfficialTemplateVariable[]
  ): IOfficialTemplateButton {
    const buttonVariables = this.extractTextVariables({
      text: button.url,
      componentType: 'BUTTON',
      buttonIndex,
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
    examples?: VariableExampleMap;
  }): IOfficialTemplateVariable[] {
    if (!input.text) {
      return [];
    }

    const found = new Map<number, IOfficialTemplateVariable>();
    const matches = input.text.matchAll(/\{\{\s*(\d+)\s*\}\}/gu);

    for (const match of matches) {
      const index = Number(match[1]);
      if (!Number.isFinite(index) || found.has(index)) {
        continue;
      }

      found.set(index, {
        key: this.variableKey(input.componentType, index, input.buttonIndex),
        component_type: input.componentType,
        index,
        button_index: input.buttonIndex ?? null,
        sample: input.examples?.[String(index)] ?? null,
      });
    }

    return [...found.values()].sort((a, b) => a.index - b.index);
  }

  private extractExamples(
    component: MetaTemplateComponent
  ): VariableExampleMap {
    const example = component.example ?? {};
    const namedExamples = this.firstArray(
      example.body_text ?? example.header_text ?? example.footer_text
    );

    return this.examplesFromArray(namedExamples);
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
    buttonIndex?: number | null
  ): string {
    if (componentType === 'BUTTON') {
      return `${componentType}:${buttonIndex ?? 0}:${index}`;
    }

    return `${componentType}:${index}`;
  }
}
