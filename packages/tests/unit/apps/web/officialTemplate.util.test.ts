import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

type EditableTemplateVariable = {
  key: string;
  component_type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTON';
  index: number;
  parameter_name?: string | null;
  button_index?: number | null;
  value: string;
};

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'apps/web/src/utils/officialTemplate.ts'),
  'utf8'
);
const schedulePickerSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'apps/web/src/components/schedule/ScheduleOfficialTemplatePicker.vue'
  ),
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
  normalizeEditableOfficialTemplateVariables: (
    variables?: unknown[]
  ) => EditableTemplateVariable[];
  buildOfficialTemplateVariablePayload: (
    variables: EditableTemplateVariable[],
    values: Record<string, string | number>
  ) => EditableTemplateVariable[];
  createOfficialTemplateVariableValueRecord: (
    variables: EditableTemplateVariable[] | undefined,
    values?: Record<string, string | number | undefined>
  ) => Record<string, string>;
  fillOfficialTemplateText: (input: {
    text: string;
    componentType: EditableTemplateVariable['component_type'];
    variables: EditableTemplateVariable[];
    values: Record<string, string | number>;
  }) => string;
};

describe('official template web utility contract', () => {
  it('recognizes both positional and named Meta placeholders', () => {
    expect(source).toContain('/\\{\\{([1-9]\\d*|[a-z][a-z0-9_]*)\\}\\}/gu');
    expect(source).toContain(
      'const parameterName = /^\\d+$/u.test(input.token)'
    );
    expect(source).toContain('variable.parameter_name) === parameterName');
  });

  it('replaces canonical Meta placeholders and preserves whitespace or malformed braces', () => {
    const variables: EditableTemplateVariable[] = [
      {
        key: 'BODY:name',
        component_type: 'BODY',
        index: 1,
        parameter_name: 'name',
        value: '',
      },
      {
        key: 'BODY:1',
        component_type: 'BODY',
        index: 1,
        value: '',
      },
    ];

    expect(
      officialTemplateUtils.fillOfficialTemplateText({
        text: '{{name}} / {{ name }} / {{{name}}} / {{name}}} / {{1}} / {{ 1 }}',
        componentType: 'BODY',
        variables,
        values: { 'BODY:name': 'Maycon', 'BODY:1': 42 },
      })
    ).toBe('Maycon / {{ name }} / {{{name}}} / {{name}}} / 42 / {{ 1 }}');
  });

  it('preserves parameter_name in editable values and outgoing payloads', () => {
    expect(source).toContain(
      'parameter_name: normalizeParameterName(variable.parameter_name)'
    );
    expect(source).toContain("'component_type' | 'index' | 'parameter_name'");
    expect(source).toContain('variableIdentifier(variable)');
  });

  it('normalizes numeric values and identifies runtime UnderChat tags', () => {
    expect(source).toContain("typeof rawValue === 'number'");
    expect(source).toContain('String(rawValue)');
    expect(source).toContain('containsUnderchatVariableTag');
    expect(source).toContain(
      '/\\{\\{\\s*[A-Za-z_][\\w]*(?:\\.[\\w]+)*\\s*\\}\\}/u'
    );
  });

  it('round-trips a manual NAMED numeric value without losing metadata', () => {
    const [hydrated] =
      officialTemplateUtils.normalizeEditableOfficialTemplateVariables([
        {
          key: 'BODY:amount',
          component_type: 'BODY',
          index: 1,
          parameter_name: 'amount',
          button_index: null,
          value: 42,
        },
      ]);

    expect(hydrated).toEqual({
      key: 'BODY:amount',
      component_type: 'BODY',
      index: 1,
      parameter_name: 'amount',
      button_index: null,
      value: '42',
    });
    expect(
      officialTemplateUtils.buildOfficialTemplateVariablePayload([hydrated], {
        [hydrated.key]: hydrated.value,
      })
    ).toEqual([hydrated]);
    expect(schedulePickerSource).toContain(
      'buildOfficialTemplateVariablePayload(variableRows.value, variableValues.value)'
    );
    expect(schedulePickerSource).toContain(
      'normalizeEditableOfficialTemplateVariables(values)'
    );
  });

  it('initializes every detected variable key before field interaction', () => {
    const variables: EditableTemplateVariable[] = [
      {
        key: 'BODY:1',
        component_type: 'BODY',
        index: 1,
        value: '',
      },
      {
        key: 'BODY:amount',
        component_type: 'BODY',
        index: 2,
        parameter_name: 'amount',
        value: '',
      },
    ];

    expect(
      officialTemplateUtils.createOfficialTemplateVariableValueRecord(
        variables,
        { 'BODY:amount': 42 }
      )
    ).toEqual({
      'BODY:1': '',
      'BODY:amount': '42',
    });
  });
});
