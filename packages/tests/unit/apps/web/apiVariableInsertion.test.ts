import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

interface VariableInsertionOptions {
  value: string | null | undefined;
  tag: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  withSpacing?: boolean;
}

interface VariableInsertionResult {
  value: string;
  cursor: number;
}

const sourcePath = path.resolve(
  process.cwd(),
  'apps/web/src/components/chatbot/api-request/variableInsertion.ts'
);
const source = fs.readFileSync(sourcePath, 'utf8');
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
const { insertVariableAtSelection } = moduleRecord.exports as unknown as {
  insertVariableAtSelection: (
    options: VariableInsertionOptions
  ) => VariableInsertionResult;
};

describe('API variable insertion', () => {
  it.each([undefined, null])(
    'inserts into an initially absent model value (%s)',
    (value) => {
      expect(
        insertVariableAtSelection({ value, tag: '{{ account_name }}' })
      ).toEqual({
        value: '{{ account_name }}',
        cursor: '{{ account_name }}'.length,
      });
    }
  );

  it('inserts at the cursor and keeps readable spacing', () => {
    expect(
      insertVariableAtSelection({
        value: 'Olá cliente',
        tag: '{{ name }}',
        selectionStart: 3,
        selectionEnd: 3,
      })
    ).toEqual({
      value: 'Olá {{ name }} cliente',
      cursor: 'Olá {{ name }}'.length,
    });
  });

  it('replaces a selected value without duplicating surrounding spaces', () => {
    expect(
      insertVariableAtSelection({
        value: 'Olá cliente tudo bem',
        tag: '{{ name }}',
        selectionStart: 4,
        selectionEnd: 11,
      })
    ).toEqual({
      value: 'Olá {{ name }} tudo bem',
      cursor: 'Olá {{ name }}'.length,
    });
  });

  it('preserves exact formatting in monospace fields', () => {
    expect(
      insertVariableAtSelection({
        value: 'token=value',
        tag: '{{ data_1.value }}',
        selectionStart: 6,
        selectionEnd: 11,
        withSpacing: false,
      })
    ).toEqual({
      value: 'token={{ data_1.value }}',
      cursor: 'token={{ data_1.value }}'.length,
    });
  });

  it('uses DOM-compatible UTF-16 cursor offsets', () => {
    const value = 'Olá 👋 mundo';
    const selection = 'Olá 👋'.length;

    expect(
      insertVariableAtSelection({
        value,
        tag: '{{ greeting }}',
        selectionStart: selection,
        selectionEnd: selection,
      })
    ).toEqual({
      value: 'Olá 👋 {{ greeting }} mundo',
      cursor: 'Olá 👋 {{ greeting }}'.length,
    });
  });
});
