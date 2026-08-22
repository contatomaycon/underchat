import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

interface EditableTemplateVariable {
  key: string;
  component_type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTON';
  index: number;
  parameter_name?: string | null;
  button_index?: number | null;
  value: string;
}

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'apps/mobile/utils/officialTemplate.ts'),
  'utf8'
);
const compiledSource = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleRecord = { exports: {} as Record<string, unknown> };
vm.runInNewContext(compiledSource, {
  exports: moduleRecord.exports,
  module: moduleRecord,
});
const officialTemplateUtils = moduleRecord.exports as unknown as {
  fillOfficialTemplateText: (input: {
    text: string;
    componentType: EditableTemplateVariable['component_type'];
    variables: EditableTemplateVariable[];
    values: EditableTemplateVariable[];
  }) => string;
};

describe('official template mobile utility contract', () => {
  it('fills only canonical Meta placeholders and keeps whitespace forms literal', () => {
    const variables: EditableTemplateVariable[] = [
      {
        key: 'BODY:greeting',
        component_type: 'BODY',
        index: 1,
        parameter_name: 'greeting',
        value: '',
      },
      {
        key: 'BODY:1',
        component_type: 'BODY',
        index: 1,
        value: '',
      },
    ];
    const values = [
      { ...variables[0], value: 'Olá' },
      { ...variables[1], value: '42' },
    ];

    expect(
      officialTemplateUtils.fillOfficialTemplateText({
        text: '{{ greeting }} / {{1}} / {{ 1 }} / {{{greeting}}}',
        componentType: 'BODY',
        variables,
        values,
      })
    ).toBe('{{ greeting }} / 42 / {{ 1 }} / {{{greeting}}}');
  });
});
