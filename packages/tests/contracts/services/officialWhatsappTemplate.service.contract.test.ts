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
        {
          key: 'empty',
          component_type: 'BODY',
          index: 2,
          button_index: null,
          value: '   ',
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
});
