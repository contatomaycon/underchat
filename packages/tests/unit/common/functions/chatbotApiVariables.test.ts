import {
  ChatbotVariableResolutionError,
  createChatbotApiVariableOutput,
  discoverChatbotApiResponseFields,
  expandChatbotVariableValues,
  extractChatbotTemplatePaths,
  resolveChatbotTemplate,
  resolveChatbotTemplateValue,
  resolveChatbotVariablePath,
  selectChatbotApiResponsePaths,
} from '@core/common/functions/chatbotApiVariables';

const response = {
  status: true,
  data: {
    results: [
      { id: 'channel-1', name: 'Maycon', ignored: 'a' },
      { id: 'channel-2', name: 'Baileys', ignored: 'b' },
    ],
  },
};

describe('chatbot API variables', () => {
  it('projects dotted paths through arrays while preserving item order', () => {
    expect(
      resolveChatbotVariablePath({ api_1: response }, 'api_1.data.results.name')
    ).toEqual({ found: true, value: ['Maycon', 'Baileys'] });
  });

  it('preserves native values for exact placeholders and renders inline values', () => {
    const variables = { api_1: response };
    expect(
      resolveChatbotTemplate('{{ api_1.data.results.id }}', variables)
    ).toEqual(['channel-1', 'channel-2']);
    expect(
      resolveChatbotTemplate(
        'Canais: {{ api_1.data.results.name }}',
        variables,
        {
          arrayFormat: 'human',
        }
      )
    ).toBe('Canais: Maycon, Baileys');
  });

  it('exposes response metadata without wrapping the response body', () => {
    const variables = {
      api_1: createChatbotApiVariableOutput(response, {
        status: 200,
        headers: { 'x-token': 'secret' },
      }),
    };

    expect(resolveChatbotTemplate('{{ api_1 }}', variables)).toEqual(response);
    expect(
      resolveChatbotTemplate('{{ api_1.data.results.name }}', variables)
    ).toEqual(['Maycon', 'Baileys']);
    expect(
      resolveChatbotTemplate('{{ api_1._response.headers.x-token }}', variables)
    ).toBe('secret');
  });

  it('resolves nested request bodies without losing array/object types', () => {
    expect(
      resolveChatbotTemplateValue(
        {
          ids: '{{ api_1.data.results.id }}',
          label: 'Itens {{ api_1.data.results.name }}',
        },
        { api_1: response }
      )
    ).toEqual({
      ids: ['channel-1', 'channel-2'],
      label: 'Itens ["Maycon","Baileys"]',
    });
  });

  it('selects multiple fields and retains the source JSON shape', () => {
    expect(
      selectChatbotApiResponsePaths(response, [
        'data.results[].id',
        'data.results.name',
      ])
    ).toEqual({
      data: {
        results: [
          { id: 'channel-1', name: 'Maycon' },
          { id: 'channel-2', name: 'Baileys' },
        ],
      },
    });
  });

  it('discovers a bounded array-aware response contract', () => {
    const paths = discoverChatbotApiResponseFields(response).map(
      (field) => `${field.path}:${field.type}`
    );
    expect(paths).toContain('data.results:array');
    expect(paths).toContain('data.results[]:object');
    expect(paths).toContain('data.results[].name:string');
  });

  it('extracts unique template dependencies', () => {
    expect(
      extractChatbotTemplatePaths(
        '{{ api_1.token }} / {{ api_1.token }} / {{ name }}'
      )
    ).toEqual(['api_1.token', 'name']);
  });

  it('expands dotted and wrapped sample keys into a safe runtime scope', () => {
    expect(
      expandChatbotVariableValues({
        'data_1.cpf': '12345678901',
        '{{ message_1.text }}': 'Olá',
      })
    ).toEqual({
      data_1: { cpf: '12345678901' },
      message_1: { text: 'Olá' },
    });

    expect(() =>
      expandChatbotVariableValues({ 'data_1.__proto__.polluted': 'yes' })
    ).toThrow(ChatbotVariableResolutionError);
  });

  it('rejects missing and prototype-polluting paths', () => {
    expect(() =>
      resolveChatbotTemplate('{{ api_1.missing }}', { api_1: {} })
    ).toThrow(ChatbotVariableResolutionError);
    expect(() => resolveChatbotVariablePath({}, '__proto__.polluted')).toThrow(
      ChatbotVariableResolutionError
    );
  });
});
