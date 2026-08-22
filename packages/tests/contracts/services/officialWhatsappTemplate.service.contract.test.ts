import 'reflect-metadata';

import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import type { MetaWhatsappApprovedTemplate } from '@core/services/metaWhatsappEmbedded.service';
import type { IOfficialWhatsappTemplate } from '@core/common/interfaces/IOfficialWhatsappTemplate';

const makeTemplate = (): MetaWhatsappApprovedTemplate => ({
  id: 'template-1',
  name: 'abertura',
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'MARKETING',
  components: [
    {
      type: 'HEADER',
      text: 'Olá {{1}}',
      example: {
        header_text: ['Maycon'],
      },
    },
    {
      type: 'BODY',
      text: 'Pedido {{1}} para {{2}}',
      example: {
        body_text: [['123', 'Cliente']],
      },
    },
    {
      type: 'BUTTONS',
      buttons: [
        {
          type: 'URL',
          text: 'Abrir pedido',
          url: 'https://underchat.test/pedido/{{1}}',
          example: ['token-123'],
        },
      ],
    },
  ],
});

const makeTemplateWithoutDetectedVariables = (): IOfficialWhatsappTemplate => ({
  name: 'sem_variaveis_detectadas',
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'MARKETING',
  components: [],
  variables: [],
  preview: {
    body: 'Olá',
    buttons: [],
  },
});

describe('OfficialWhatsappTemplateService', () => {
  it('keeps whitespace brace text literal and excludes incompatible syntax', () => {
    const service = new OfficialWhatsappTemplateService();
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const templates = service.normalizeTemplates([
      {
        id: 'malformed-1',
        name: 'followup_comercial',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'BODY',
            text: 'Olá {{ name }}!',
          },
        ],
      },
      {
        id: 'valid-1',
        name: 'service_update',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'BODY',
            text: 'Olá {{name}}!',
            example: {
              body_text_named_params: [
                { param_name: 'name', example: 'Maycon' },
              ],
            },
          },
        ],
      },
      {
        id: 'mismatched-format-1',
        name: 'mismatched_format',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'POSITIONAL',
        components: [
          {
            type: 'BODY',
            text: 'Olá {{name}}!',
          },
        ],
      },
    ]);

    expect(templates).toHaveLength(2);
    expect(templates[0]).toMatchObject({
      name: 'followup_comercial',
      variables: [],
      preview: { body: 'Olá {{ name }}!' },
    });
    expect(templates[1]).toMatchObject({
      name: 'service_update',
      variables: [expect.objectContaining({ key: 'BODY:name' })],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('invalid Meta variable syntax'),
      expect.objectContaining({ template_name: 'mismatched_format' })
    );
    warn.mockRestore();
  });

  it.each([
    ['NAMED', 'Olá {{Name}}'],
    ['POSITIONAL', 'Olá {{0}}'],
    ['POSITIONAL', 'Olá {{2}}'],
    ['POSITIONAL', 'Olá {{1}} e {{3}}'],
    ['POSITIONAL', 'Olá {{name}}'],
    ['NAMED', 'Olá {{{name}}}'],
    ['NAMED', 'Olá {{name}}}'],
  ] as const)(
    'rejects malformed or incompatible %s placeholder text before enqueueing',
    (parameterFormat, body) => {
      const service = new OfficialWhatsappTemplateService();
      const malformed: IOfficialWhatsappTemplate = {
        id: 'malformed',
        name: 'malformed',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: parameterFormat,
        components: [{ type: 'BODY', text: body, variables: [] }],
        variables: [],
        preview: { body },
      };

      expect(() => service.buildPreviewText(malformed, [])).toThrow(
        'official_template_variable_syntax_invalid'
      );
      expect(() =>
        service.validateVariableValues({ template: malformed, values: [] })
      ).toThrow('official_template_variable_syntax_invalid');
    }
  );

  it('does not invent parameters for an authoritative template with no variables', () => {
    const service = new OfficialWhatsappTemplateService();
    const template: IOfficialWhatsappTemplate = {
      id: 'plain-1',
      name: 'plain',
      language: 'pt_BR',
      status: 'APPROVED',
      category: 'UTILITY',
      parameter_format: 'NAMED',
      components: [{ type: 'BODY', text: 'Olá!', variables: [] }],
      variables: [],
      preview: { body: 'Olá!' },
    };

    expect(() =>
      service.validateVariableValues({
        template,
        values: [
          {
            key: 'BODY:name',
            component_type: 'BODY',
            index: 1,
            parameter_name: 'name',
            value: 'Maycon',
          },
        ],
      })
    ).toThrow('official_template_variables_invalid');
  });

  it('extracts variables from body, header and URL buttons', () => {
    const service = new OfficialWhatsappTemplateService();
    const [template] = service.normalizeTemplates([makeTemplate()]);

    expect(template.variables).toEqual([
      {
        key: 'HEADER:1',
        component_type: 'HEADER',
        index: 1,
        button_index: null,
        sample: 'Maycon',
      },
      {
        key: 'BODY:1',
        component_type: 'BODY',
        index: 1,
        button_index: null,
        sample: '123',
      },
      {
        key: 'BODY:2',
        component_type: 'BODY',
        index: 2,
        button_index: null,
        sample: 'Cliente',
      },
      {
        key: 'BUTTON:0:1',
        component_type: 'BUTTON',
        index: 1,
        button_index: 0,
        sample: 'token-123',
      },
    ]);
    expect(template.preview).toEqual({
      header: 'Olá {{1}}',
      body: 'Pedido {{1}} para {{2}}',
      footer: null,
      buttons: ['Abrir pedido'],
    });
    expect(template.components[2]?.buttons?.[0]?.variables).toEqual([
      {
        key: 'BUTTON:0:1',
        component_type: 'BUTTON',
        index: 1,
        button_index: 0,
        sample: 'token-123',
      },
    ]);

    const positionalValues = service.validateVariableValues({
      template,
      values: [
        {
          key: 'HEADER:1',
          component_type: 'HEADER',
          index: 1,
          value: 'Maycon',
        },
        {
          key: 'BODY:1',
          component_type: 'BODY',
          index: 1,
          value: 123,
        },
        {
          key: 'BODY:2',
          component_type: 'BODY',
          index: 2,
          value: 'Cliente',
        },
        {
          key: 'BUTTON:0:1',
          component_type: 'BUTTON',
          index: 1,
          button_index: 0,
          value: 456,
        },
      ],
    });
    expect(
      service.buildMetaComponents(positionalValues, template.components)
    ).toEqual([
      {
        type: 'header',
        parameters: [{ type: 'text', text: 'Maycon' }],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: '123' },
          { type: 'text', text: 'Cliente' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '456' }],
      },
    ]);
  });

  it('preserves positional dynamic URL variables in a named template', () => {
    const service = new OfficialWhatsappTemplateService();
    const [template] = service.normalizeTemplates([
      {
        id: 'named-with-url-1',
        name: 'named_with_url',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'BODY',
            text: 'Olá {{name}}',
            example: {
              body_text_named_params: [
                { param_name: 'name', example: 'Maycon' },
              ],
            },
          },
          {
            type: 'BUTTONS',
            buttons: [
              {
                type: 'URL',
                text: 'Abrir link',
                url: 'https://underchat.test/{{1}}',
                example: ['customer-123'],
              },
            ],
          },
        ],
      },
    ]);

    expect(template.variables).toEqual([
      expect.objectContaining({
        key: 'BODY:name',
        component_type: 'BODY',
        parameter_name: 'name',
      }),
      expect.objectContaining({
        key: 'BUTTON:0:1',
        component_type: 'BUTTON',
        index: 1,
        button_index: 0,
      }),
    ]);

    const values = service.validateVariableValues({
      template,
      values: [
        {
          key: 'BODY:name',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'name',
          value: 'Maycon',
        },
        {
          key: 'BUTTON:0:1',
          component_type: 'BUTTON',
          index: 1,
          button_index: 0,
          value: 123,
        },
      ],
    });

    expect(service.buildMetaComponents(values, template.components)).toEqual([
      {
        type: 'body',
        parameters: [{ type: 'text', text: 'Maycon', parameter_name: 'name' }],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '123' }],
      },
    ]);
  });

  it('sends zero BODY parameters for literal whitespace braces and preserves QUICK_REPLY', () => {
    const service = new OfficialWhatsappTemplateService();
    const [template] = service.normalizeTemplates([
      {
        id: 'harmonia-opening-template',
        name: 'iniciar_conversa_novo',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'BODY',
            text: 'Bom dia {{ greeting }}',
            example: {
              body_text_named_params: [
                { param_name: 'greeting', example: 'Bom dia' },
              ],
            },
          },
          {
            type: 'BUTTONS',
            buttons: [
              {
                type: 'QUICK_REPLY',
                text: 'Continuar atendimento',
              },
            ],
          },
        ],
      },
    ]);

    expect(template.variables).toEqual([]);
    expect(service.validateVariableValues({ template, values: [] })).toEqual(
      []
    );

    const legacyValues = [
      {
        key: 'BODY:greeting',
        component_type: 'BODY' as const,
        index: 1,
        parameter_name: 'greeting',
        button_index: null,
        value: 'Bom dia',
      },
    ];

    expect(
      service.buildMetaComponents(legacyValues, template.components)
    ).toEqual([
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'Continuar atendimento' }],
      },
    ]);
  });

  it('sends a named BODY parameter for a canonical placeholder without whitespace', () => {
    const service = new OfficialWhatsappTemplateService();
    const [template] = service.normalizeTemplates([
      {
        id: 'canonical-named-template',
        name: 'iniciar_conversa_canonico',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'BODY',
            text: 'Bom dia {{greeting}}',
            example: {
              body_text_named_params: [
                { param_name: 'greeting', example: 'Bom dia' },
              ],
            },
          },
        ],
      },
    ]);

    expect(template.variables).toEqual([
      expect.objectContaining({
        key: 'BODY:greeting',
        parameter_name: 'greeting',
      }),
    ]);
    const values = service.validateVariableValues({
      template,
      values: [
        {
          key: 'BODY:greeting',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'greeting',
          value: 'Olá',
        },
      ],
    });

    expect(service.buildMetaComponents(values, template.components)).toEqual([
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: 'Olá',
            parameter_name: 'greeting',
          },
        ],
      },
    ]);
  });

  it('filters legacy whitespace HEADER and BODY values but preserves a positional URL button', () => {
    const service = new OfficialWhatsappTemplateService();

    expect(
      service.buildMetaComponents(
        [
          {
            key: 'HEADER:code',
            component_type: 'HEADER',
            index: 1,
            parameter_name: 'code',
            button_index: null,
            value: 'ABC',
          },
          {
            key: 'BODY:greeting',
            component_type: 'BODY',
            index: 1,
            parameter_name: 'greeting',
            button_index: null,
            value: 'Olá',
          },
          {
            key: 'BUTTON:1:1',
            component_type: 'BUTTON',
            index: 1,
            button_index: 1,
            value: 'customer-123',
          },
        ],
        [
          { type: 'HEADER', text: 'Código literal {{ code }}' },
          { type: 'BODY', text: 'Saudação literal {{ greeting }}' },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'QUICK_REPLY', text: 'Continuar atendimento' },
              {
                type: 'URL',
                text: 'Abrir cliente',
                url: 'https://underchat.test/clientes/{{1}}',
              },
            ],
          },
        ]
      )
    ).toEqual([
      {
        type: 'button',
        sub_type: 'url',
        index: '1',
        parameters: [{ type: 'text', text: 'customer-123' }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'Continuar atendimento' }],
      },
    ]);
  });

  it('keeps manually provided variables when no variables were detected', () => {
    const service = new OfficialWhatsappTemplateService();

    const variables = service.validateVariableValues({
      template: makeTemplateWithoutDetectedVariables(),
      values: [
        {
          key: 'old-key',
          component_type: 'BODY',
          index: 1,
          button_index: null,
          value: ' Cliente ',
        },
        {
          key: 'old-button-key',
          component_type: 'BUTTON',
          index: 1,
          button_index: 2,
          value: ' token ',
        },
      ],
    });

    expect(variables).toEqual([
      {
        key: 'BODY:1',
        component_type: 'BODY',
        index: 1,
        button_index: null,
        value: 'Cliente',
      },
      {
        key: 'BUTTON:2:1',
        component_type: 'BUTTON',
        index: 1,
        button_index: 2,
        value: 'token',
      },
    ]);
  });

  it('requires values for variables detected in the template', () => {
    const service = new OfficialWhatsappTemplateService();
    const [template] = service.normalizeTemplates([makeTemplate()]);

    expect(() =>
      service.validateVariableValues({
        template,
        values: [
          {
            key: 'HEADER:1',
            component_type: 'HEADER',
            index: 1,
            button_index: null,
            value: 'Maycon',
          },
        ],
      })
    ).toThrow('official_template_variables_required');
  });

  it('normalizes named parameters, named examples, preview and Meta payload', () => {
    const service = new OfficialWhatsappTemplateService();
    const [template] = service.normalizeTemplates([
      {
        id: 'named-1',
        name: 'service_update',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'HEADER',
            text: 'Conta {{account_name}}',
            example: {
              header_text_named_params: [
                { param_name: 'account_name', example: 'UnderChat' },
              ],
            },
          },
          {
            type: 'BODY',
            text: 'Olá, {{name}}. Seu saldo é {{amount}}.',
            example: {
              body_text_named_params: [
                { param_name: 'name', example: 'Maycon' },
                { param_name: 'amount', example: '42' },
              ],
            },
          },
        ],
      },
    ]);

    expect(template.parameter_format).toBe('NAMED');
    expect(template.variables).toEqual([
      expect.objectContaining({
        key: 'HEADER:account_name',
        index: 1,
        parameter_name: 'account_name',
        sample: 'UnderChat',
      }),
      expect.objectContaining({
        key: 'BODY:name',
        index: 1,
        parameter_name: 'name',
        sample: 'Maycon',
      }),
      expect.objectContaining({
        key: 'BODY:amount',
        index: 2,
        parameter_name: 'amount',
        sample: '42',
      }),
    ]);

    const values = service.validateVariableValues({
      template,
      values: [
        {
          key: 'HEADER:account_name',
          component_type: 'HEADER',
          index: 1,
          parameter_name: 'account_name',
          value: ' UnderChat ',
        },
        {
          key: 'BODY:name',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'name',
          value: ' Maycon ',
        },
        {
          key: 'BODY:amount',
          component_type: 'BODY',
          index: 2,
          parameter_name: 'amount',
          value: 42,
        },
      ],
    });

    expect(service.buildPreviewText(template, values)).toBe(
      'Conta UnderChat\n\nOlá, Maycon. Seu saldo é 42.'
    );
    expect(service.buildMetaComponents(values, template.components)).toEqual([
      {
        type: 'header',
        parameters: [
          {
            type: 'text',
            text: 'UnderChat',
            parameter_name: 'account_name',
          },
        ],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maycon', parameter_name: 'name' },
          { type: 'text', text: '42', parameter_name: 'amount' },
        ],
      },
    ]);
  });

  it.each(['   ', Number.NaN, Number.POSITIVE_INFINITY, {}, []])(
    'rejects invalid template variable value %p',
    (value) => {
      const service = new OfficialWhatsappTemplateService();
      expect(() => service.normalizeVariableValue(value)).toThrow(
        'official_template_variable_value_invalid'
      );
    }
  );
});
