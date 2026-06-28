import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  cleanupSVG,
  importDirectory,
  isEmptyColor,
  parseColors,
  runSVGO,
} from '@iconify/tools';
import type { IconifyJSON } from '@iconify/types';
import { getIcons, getIconsCSS, stringToIcon } from '@iconify/utils';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '../../..');
const sourceRoot = join(appRoot, 'src');
const themeConfigFile = join(appRoot, 'themeConfig.ts');
const sourceFileExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
]);
const ignoredSourceDirectories = new Set([
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);
const dynamicFallbackTablerIcons = ['pinned-off', 'rocket'];

interface BundleScriptCustomSVGConfig {
  dir: string;
  monotone: boolean;
  prefix: string;
}

interface BundleScriptCustomJSONConfig {
  filename: string;
  icons?: string[];
}

interface BundleScriptConfig {
  svg?: BundleScriptCustomSVGConfig[];
  icons?: string[];
  json?: (string | BundleScriptCustomJSONConfig)[];
}

function organizeIconsList(icons: string[]): Record<string, string[]> {
  const sorted: Record<string, string[]> = {};
  for (const icon of icons) {
    const item = stringToIcon(icon);
    if (!item) continue;
    if (!sorted[item.prefix]) sorted[item.prefix] = [];
    if (!sorted[item.prefix].includes(item.name))
      sorted[item.prefix].push(item.name);
  }
  return sorted;
}

async function processSVGIcon(
  name: string,
  type: string,
  source: BundleScriptCustomSVGConfig,
  iconSet: any
) {
  if (type !== 'icon') {
    iconSet.remove(name);
    return;
  }
  const svg = iconSet.toSVG(name);
  if (!svg) {
    iconSet.remove(name);
    return;
  }
  try {
    cleanupSVG(svg);
    if (source.monotone) {
      parseColors(svg, {
        defaultColor: 'currentColor',
        callback: (_, colorStr, color) =>
          !color || isEmptyColor(color) ? colorStr : 'currentColor',
      });
    }
    runSVGO(svg);
    iconSet.fromSVG(name, svg);
  } catch {
    iconSet.remove(name);
  }
}

async function processJsonSources(
  jsonSources: (string | BundleScriptCustomJSONConfig)[],
  allIcons: IconifyJSON[]
) {
  for (const item of jsonSources) {
    const filename = typeof item === 'string' ? item : item.filename;
    const content = JSON.parse(
      await fs.readFile(filename, 'utf8')
    ) as IconifyJSON;
    if (content.prefix === 'tabler') {
      for (const key in content.icons) {
        content.icons[key].body = content.icons[key].body.replaceAll(
          'stroke-width="2"',
          'stroke-width="1.5"'
        );
      }
    }
    if (typeof item !== 'string' && item.icons?.length) {
      const filtered = getIcons(content, item.icons);
      if (!filtered)
        throw new Error(`Cannot find required icons in ${filename}`);
      allIcons.push(filtered);
      continue;
    }
    allIcons.push(content);
  }
}

async function processSvgSources(
  svgSources: BundleScriptCustomSVGConfig[],
  allIcons: IconifyJSON[]
) {
  for (const source of svgSources) {
    const iconSet = await importDirectory(source.dir, {
      prefix: source.prefix,
    });

    const entries: Array<[string, string]> = [];
    const exported = iconSet.export();
    for (const name of Object.keys(exported.icons)) {
      entries.push([name, 'icon']);
    }
    for (const name of Object.keys(exported.aliases ?? {})) {
      entries.push([name, 'alias']);
    }

    for (const [name, type] of entries) {
      await processSVGIcon(name, type, source, iconSet);
    }

    allIcons.push(iconSet.export());
  }
}

async function processSources(
  sources: BundleScriptConfig,
  allIcons: IconifyJSON[]
) {
  if (sources.json) await processJsonSources(sources.json, allIcons);
  if (sources.svg) await processSvgSources(sources.svg, allIcons);
}

function shouldScanSourceFile(filePath: string): boolean {
  return sourceFileExtensions.has(filePath.slice(filePath.lastIndexOf('.')));
}

async function collectSourceFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return shouldScanSourceFile(target) ? [target] : [];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  const entries = await fs.readdir(target, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredSourceDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = join(target, entry.name);
    if (entryPath.includes('/plugins/iconify/')) {
      continue;
    }

    files.push(...(await collectSourceFiles(entryPath)));
  }

  return files;
}

async function collectUsedTablerIconNames(): Promise<string[]> {
  const icons = new Set(dynamicFallbackTablerIcons);
  const files = [
    ...(await collectSourceFiles(sourceRoot)),
    ...(await collectSourceFiles(themeConfigFile)),
  ];
  const iconPattern = /(?<![\w-])tabler-([a-z0-9-]+)/g;

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');

    for (const match of content.matchAll(iconPattern)) {
      if (match[1]) {
        icons.add(match[1]);
      }
    }
  }

  return [...icons].sort((first, second) => first.localeCompare(second));
}

async function generateCSS(target: string, allIcons: IconifyJSON[]) {
  const cssContent = allIcons
    .map((iconSet) =>
      getIconsCSS(iconSet, Object.keys(iconSet.icons), {
        iconSelector: '.{prefix}-{name}',
        mode: 'mask',
      })
    )
    .join('\n');
  await fs.writeFile(target, cssContent, 'utf8');
}

async function createSources(): Promise<BundleScriptConfig> {
  return {
    svg: [],
    icons: [],
    json: [
      {
        filename: require.resolve('@iconify-json/tabler/icons.json'),
        icons: await collectUsedTablerIconNames(),
      },
      {
        filename: require.resolve('@iconify-json/mdi/icons.json'),
        icons: ['close-circle', 'language-javascript', 'language-typescript'],
      },
      {
        filename: require.resolve('@iconify-json/fa/icons.json'),
        icons: ['circle'],
      },
    ],
  };
}

const target = join(__dirname, 'icons.css');

await fs.mkdir(dirname(target), { recursive: true });
const allIcons: IconifyJSON[] = [];
const sources = await createSources();
if (sources.icons) {
  const sourcesJSON = sources.json || (sources.json = []);
  const organizedList = organizeIconsList(sources.icons);
  for (const prefix in organizedList) {
    sourcesJSON.push({
      filename: require.resolve(`@iconify/json/json/${prefix}.json`),
      icons: organizedList[prefix],
    });
  }
}
await processSources(sources, allIcons);
await generateCSS(target, allIcons);
