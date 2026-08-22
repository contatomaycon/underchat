import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'apps/web/src/utils/messageTemplateChannelSelection.ts'
  ),
  'utf8'
);
const editMessageTemplateSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'apps/web/src/components/messageTemplate/AppEditMessageTemplate.vue'
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
const { reconcileMessageTemplateChannelIds } = moduleRecord.exports as {
  reconcileMessageTemplateChannelIds: (
    selectedChannelIds: readonly string[] | null | undefined,
    availableChannelIds: readonly string[]
  ) => string[];
};

describe('message template channel selection', () => {
  it('removes a deleted channel identity while retaining the current channel', () => {
    expect(
      reconcileMessageTemplateChannelIds(
        ['deleted-worker-id', 'current-worker-id'],
        ['current-worker-id']
      )
    ).toEqual(['current-worker-id']);
  });

  it('removes duplicate and unavailable identities without inventing a mapping', () => {
    expect(
      reconcileMessageTemplateChannelIds(
        ['deleted-worker-id', 'deleted-worker-id'],
        ['current-worker-id']
      )
    ).toEqual([]);
  });

  it('reconciles persisted ids only after the current channel options load', () => {
    expect(editMessageTemplateSource).toContain(
      'const channelsLoaded = await loadChannelOptions();'
    );
    expect(editMessageTemplateSource).toContain(
      'reconcileMessageTemplateChannelIds('
    );
    expect(
      editMessageTemplateSource.indexOf('await loadChannelOptions()')
    ).toBeLessThan(
      editMessageTemplateSource.indexOf('getMessageTemplateById(id)')
    );
  });
});
