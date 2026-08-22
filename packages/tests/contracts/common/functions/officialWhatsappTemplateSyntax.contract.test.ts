import {
  inferOfficialWhatsappTemplateParameterFormat,
  inspectOfficialWhatsappTemplateTextSyntax,
} from '@core/common/functions/officialWhatsappTemplateSyntax';

describe('officialWhatsappTemplateSyntax', () => {
  it('recognizes only canonical Meta placeholders and keeps whitespace forms literal', () => {
    expect(
      inspectOfficialWhatsappTemplateTextSyntax(
        'Olá {{ name }}, pedido {{order_2}}',
        'NAMED'
      )
    ).toEqual({ valid: true, tokens: ['order_2'] });
    expect(
      inspectOfficialWhatsappTemplateTextSyntax(
        'Pedido literal {{ 1 }} com parâmetro {{1}}',
        'POSITIONAL'
      )
    ).toEqual({ valid: true, tokens: ['1'] });
  });

  it.each([
    ['NAMED', '{{Name}}'],
    ['NAMED', '{{name-id}}'],
    ['POSITIONAL', '{{0}}'],
    ['POSITIONAL', '{{2}}'],
    ['POSITIONAL', '{{1}} e {{3}}'],
    ['POSITIONAL', '{{name}}'],
    ['NAMED', '{{name}'],
    ['NAMED', '{{{name}}}'],
    ['NAMED', '{{name}}}'],
  ] as const)('rejects malformed %s syntax in %s', (format, text) => {
    expect(inspectOfficialWhatsappTemplateTextSyntax(text, format).valid).toBe(
      false
    );
  });

  it('infers format only from canonical Meta placeholders', () => {
    expect(
      inferOfficialWhatsappTemplateParameterFormat(['Olá {{ name }}'])
    ).toBe('POSITIONAL');
    expect(inferOfficialWhatsappTemplateParameterFormat(['Olá {{name}}'])).toBe(
      'NAMED'
    );
    expect(inferOfficialWhatsappTemplateParameterFormat(['Olá {{1}}'])).toBe(
      'POSITIONAL'
    );
    expect(
      inferOfficialWhatsappTemplateParameterFormat(['Olá {{{name}}}'])
    ).toBe('POSITIONAL');
  });
});
