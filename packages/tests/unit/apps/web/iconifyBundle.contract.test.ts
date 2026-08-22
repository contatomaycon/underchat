import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const sourceExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
]);
const ignoredDirectories = new Set([
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);

const collectSourceFiles = (target: string): string[] => {
  const stat = statSync(target);
  if (stat.isFile())
    return sourceExtensions.has(extname(target)) ? [target] : [];
  if (!stat.isDirectory()) return [];

  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];

    const entryPath = join(target, entry.name);
    if (entryPath.includes('/plugins/iconify/')) return [];

    return collectSourceFiles(entryPath);
  });
};

const collectUsedTablerIcons = (): string[] => {
  const webRoot = resolve(process.cwd(), 'apps/web');
  const icons = new Set(['pinned-off', 'rocket']);
  const files = [
    ...collectSourceFiles(join(webRoot, 'src')),
    ...collectSourceFiles(join(webRoot, 'themeConfig.ts')),
  ];
  const iconPattern = /(?<![\w-])tabler-([a-z0-9-]+)/g;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(iconPattern)) {
      if (match[1]) icons.add(match[1]);
    }
  }

  return [...icons].sort();
};

describe('web Iconify bundle contract', () => {
  const usedIcons = collectUsedTablerIcons();
  const tablerCatalog = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'node_modules/@iconify-json/tabler/icons.json'),
      'utf8'
    )
  ) as {
    aliases?: Record<string, unknown>;
    icons: Record<string, unknown>;
  };
  const catalogIcons = new Set([
    ...Object.keys(tablerCatalog.icons),
    ...Object.keys(tablerCatalog.aliases ?? {}),
  ]);
  const iconCss = readFileSync(
    resolve(process.cwd(), 'apps/web/src/plugins/iconify/icons.css'),
    'utf8'
  );

  it('uses only names available in the installed Tabler catalogue', () => {
    const missingIcons = usedIcons.filter((icon) => !catalogIcons.has(icon));

    expect(missingIcons).toEqual([]);
  });

  it('emits every referenced Tabler icon into the runtime CSS', () => {
    const missingIcons = usedIcons.filter(
      (icon) => !iconCss.includes(`.tabler-${icon} {`)
    );

    expect(missingIcons).toEqual([]);
  });
});
