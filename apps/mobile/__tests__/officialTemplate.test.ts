import { describe, expect, it } from '@jest/globals';
import {
  areOfficialTemplateVariablesValid,
  buildOfficialTemplatePreview,
  buildOfficialTemplateRequest,
  createOfficialTemplateVariableValues,
  createManualOfficialTemplateVariable,
  formatOfficialTemplateVariableLabel,
  refreshOfficialTemplateVariableKey,
} from '../utils/officialTemplate';
import type { OfficialTemplate } from '../types/chat';

describe('officialTemplate manual variables', () => {
  it('only replaces placeholders that follow the exact Meta grammar', () => {
    const template: OfficialTemplate = {
      id: 'strict-template',
      name: 'strict_template',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'UTILITY',
      parameter_format: 'NAMED',
      components: [],
      variables: [
        {
          key: 'BODY:name',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'name',
          button_index: null,
          sample: null,
        },
      ],
      preview: {
        body: 'Olá {{name}} / {{ name }} / {{{name}}} / {{name}}}.',
      },
    };

    expect(
      buildOfficialTemplatePreview(template, [
        {
          key: 'BODY:name',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'name',
          button_index: null,
          value: 'Maycon',
        },
      ])?.body
    ).toBe('Olá Maycon / {{ name }} / {{{name}}} / {{name}}}.');
  });

  it('normalizes finite numeric values in positional preview and payload', () => {
    const template: OfficialTemplate = {
      id: 'numeric-template',
      name: 'numeric_template',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'UTILITY',
      parameter_format: 'POSITIONAL',
      components: [],
      variables: [
        {
          key: 'BODY:1',
          component_type: 'BODY',
          index: 1,
          button_index: null,
          sample: null,
        },
      ],
      preview: { body: 'Pedido {{1}}' },
    };
    const values = [
      {
        key: 'BODY:1',
        component_type: 'BODY' as const,
        index: 1,
        button_index: null,
        value: 42,
      },
    ];

    expect(areOfficialTemplateVariablesValid(template, values)).toBe(true);
    expect(buildOfficialTemplatePreview(template, values)?.body).toBe(
      'Pedido 42'
    );
    expect(buildOfficialTemplateRequest(template, values).variables).toEqual([
      expect.objectContaining({ key: 'BODY:1', value: '42' }),
    ]);

    expect(
      areOfficialTemplateVariablesValid(template, [
        { ...values[0], value: Number.POSITIVE_INFINITY },
      ])
    ).toBe(false);
  });

  it('creates manual BODY variables by default', () => {
    expect(createManualOfficialTemplateVariable(0)).toEqual({
      key: 'BODY:1',
      component_type: 'BODY',
      index: 1,
      button_index: null,
      value: '',
    });
  });

  it('recalculates a manual HEADER variable key', () => {
    const variable = refreshOfficialTemplateVariableKey({
      ...createManualOfficialTemplateVariable(0),
      component_type: 'HEADER',
      index: 1,
      value: 'Header value',
    });

    expect(variable).toMatchObject({
      key: 'HEADER:1',
      component_type: 'HEADER',
      index: 1,
      button_index: null,
      value: 'Header value',
    });
  });

  it('recalculates a manual BODY variable key', () => {
    const variable = refreshOfficialTemplateVariableKey({
      ...createManualOfficialTemplateVariable(0),
      component_type: 'BODY',
      index: 2,
      value: 'Body value',
    });

    expect(variable).toMatchObject({
      key: 'BODY:2',
      component_type: 'BODY',
      index: 2,
      button_index: null,
      value: 'Body value',
    });
  });

  it('recalculates a manual BUTTON variable key with button index', () => {
    const variable = refreshOfficialTemplateVariableKey({
      ...createManualOfficialTemplateVariable(0),
      component_type: 'BUTTON',
      index: 1,
      button_index: 2,
      value: 'https://underchat.example',
    });

    expect(variable).toMatchObject({
      key: 'BUTTON:2:1',
      component_type: 'BUTTON',
      index: 1,
      button_index: 2,
      value: 'https://underchat.example',
    });
  });

  it('preserves value when component and index change', () => {
    const variable = refreshOfficialTemplateVariableKey({
      ...createManualOfficialTemplateVariable(0),
      component_type: 'HEADER',
      index: 3,
      value: 'Keep me',
    });

    expect(variable.key).toBe('HEADER:3');
    expect(variable.value).toBe('Keep me');
  });

  it('keeps named parameter identity from Meta through preview and request', () => {
    const template: OfficialTemplate = {
      id: 'template-1',
      name: 'welcome_named',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'UTILITY',
      parameter_format: 'NAMED',
      components: [
        {
          type: 'BODY',
          text: 'Olá, {{name}}!',
          variables: [
            {
              key: 'BODY:name',
              component_type: 'BODY',
              index: 1,
              parameter_name: 'name',
              button_index: null,
              sample: 'Maycon',
            },
          ],
        },
      ],
      variables: [
        {
          key: 'BODY:name',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'name',
          button_index: null,
          sample: 'Maycon',
        },
      ],
      preview: { body: 'Olá, {{name}}!' },
    };
    const values = createOfficialTemplateVariableValues(template.variables);
    values[0] = { ...values[0], value: '{{ name }}' };

    expect(formatOfficialTemplateVariableLabel(template.variables[0])).toBe(
      'BODY {{name}}'
    );
    expect(buildOfficialTemplatePreview(template, values)?.body).toBe(
      'Olá, {{ name }}!'
    );
    expect(buildOfficialTemplateRequest(template, values).variables).toEqual([
      expect.objectContaining({
        key: 'BODY:name',
        parameter_name: 'name',
        value: '{{ name }}',
      }),
    ]);
  });
});
