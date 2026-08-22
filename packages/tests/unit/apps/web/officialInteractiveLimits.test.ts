import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

type LimitViolation = {
  field: string;
  limit: number;
  actual: number;
} | null;

type OfficialInteractiveLimitsModule = {
  OFFICIAL_INTERACTIVE_LIMITS: Record<string, number>;
  countOfficialInteractiveCharacters: (value: unknown) => number;
  findOfficialInteractiveLimitViolation: (
    nodeType: string,
    data: Record<string, unknown> | undefined
  ) => LimitViolation;
};

const source = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'apps/web/src/utils/officialInteractiveLimits.ts'
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
const limitsModule =
  moduleRecord.exports as unknown as OfficialInteractiveLimitsModule;
const { OFFICIAL_INTERACTIVE_LIMITS, findOfficialInteractiveLimitViolation } =
  limitsModule;

describe('official interactive Meta limits', () => {
  it('uses the requested Meta boundaries and counts emoji as one character', () => {
    expect(OFFICIAL_INTERACTIVE_LIMITS).toEqual(
      expect.objectContaining({
        header: 60,
        body: 1_024,
        footer: 60,
        listButtonTitle: 20,
        listOptionTitle: 24,
        listOptionDescription: 72,
        sectionTitle: 24,
        replyButtonTitle: 20,
        replyButtonCount: 3,
        ctaButtonTitle: 20,
        flowCtaTitle: 30,
        productSectionCount: 10,
        productItemCount: 30,
      })
    );
    expect(limitsModule.countOfficialInteractiveCharacters('a😀b')).toBe(3);
    expect(source).toContain('Array.from(readText(value)).length');
  });

  it('accepts every field exactly at the Meta boundary', () => {
    const data = {
      header: 'H'.repeat(OFFICIAL_INTERACTIVE_LIMITS.header),
      message: 'B'.repeat(OFFICIAL_INTERACTIVE_LIMITS.body),
      footer: 'F'.repeat(OFFICIAL_INTERACTIVE_LIMITS.footer),
      buttonText: 'L'.repeat(OFFICIAL_INTERACTIVE_LIMITS.listButtonTitle),
      sectionTitle: 'S'.repeat(OFFICIAL_INTERACTIVE_LIMITS.sectionTitle),
      options: [
        {
          id: '1',
          text: 'T'.repeat(OFFICIAL_INTERACTIVE_LIMITS.listOptionTitle),
          description: 'D'.repeat(
            OFFICIAL_INTERACTIVE_LIMITS.listOptionDescription
          ),
        },
      ],
    };

    expect(findOfficialInteractiveLimitViolation('officialList', data)).toBe(
      null
    );
  });

  const violationCases: Array<
    [string, string, Record<string, unknown>, number]
  > = [
    ['header', 'officialList', { header: 'x'.repeat(61) }, 60],
    ['body', 'officialLocationRequest', { message: 'x'.repeat(1_025) }, 1_024],
    ['footer', 'officialCtaUrl', { footer: 'x'.repeat(61) }, 60],
    ['listButtonTitle', 'officialList', { buttonText: 'x'.repeat(21) }, 20],
    ['sectionTitle', 'officialList', { sectionTitle: 'x'.repeat(25) }, 24],
    [
      'listOptionTitle',
      'officialList',
      { options: [{ id: '1', text: 'x'.repeat(25) }] },
      24,
    ],
    [
      'listOptionDescription',
      'officialList',
      { options: [{ id: '1', text: 'ok', description: 'x'.repeat(73) }] },
      72,
    ],
    [
      'replyButtonTitle',
      'officialReplyButtons',
      { options: [{ id: '1', text: 'x'.repeat(21) }] },
      20,
    ],
    [
      'replyButtonCount',
      'officialReplyButtons',
      {
        options: [
          { id: '1', text: '1' },
          { id: '2', text: '2' },
          { id: '3', text: '3' },
          { id: '4', text: '4' },
        ],
      },
      3,
    ],
    ['ctaButtonTitle', 'officialCtaUrl', { buttonText: 'x'.repeat(21) }, 20],
    ['flowCtaTitle', 'officialFlow', { buttonText: 'x'.repeat(31) }, 30],
    [
      'sectionTitle',
      'officialMultiProduct',
      { sections: [{ title: 'x'.repeat(25) }] },
      24,
    ],
    [
      'productSectionCount',
      'officialMultiProduct',
      {
        sections: Array.from({ length: 11 }, () => ({ title: 'Produtos' })),
      },
      10,
    ],
    [
      'productItemCount',
      'officialMultiProduct',
      {
        sections: [
          {
            title: 'Produtos',
            product_items: Array.from({ length: 31 }, (_, index) => ({
              product_retailer_id: String(index),
            })),
          },
        ],
      },
      30,
    ],
  ];

  it.each(violationCases)(
    'reports %s without changing the original node data',
    (field, nodeType, data, limit) => {
      const snapshot = JSON.stringify(data);
      const violation = findOfficialInteractiveLimitViolation(nodeType, data);

      expect(violation).toEqual(
        expect.objectContaining({ field, limit, actual: limit + 1 })
      );
      expect(JSON.stringify(data)).toBe(snapshot);
    }
  );

  it('rejects emoji only in the Flow CTA', () => {
    for (const buttonText of ['Abrir 😀', 'Abrir 🇧🇷', 'Abrir 1️⃣', 'Abrir 👍🏽']) {
      expect(
        findOfficialInteractiveLimitViolation('officialFlow', { buttonText })
      ).toEqual(
        expect.objectContaining({ field: 'flowCtaEmoji', kind: 'emoji' })
      );
    }
    expect(
      findOfficialInteractiveLimitViolation('officialCtaUrl', {
        buttonText: 'Abrir 😀',
      })
    ).toBeNull();
  });

  it('ignores unsupported legacy header on a single product and still validates its footer', () => {
    expect(
      findOfficialInteractiveLimitViolation('officialSingleProduct', {
        header: 'x'.repeat(61),
      })
    ).toBeNull();
    expect(
      findOfficialInteractiveLimitViolation('officialSingleProduct', {
        footer: 'x'.repeat(61),
      })
    ).toEqual(expect.objectContaining({ field: 'footer', limit: 60 }));
  });
});
