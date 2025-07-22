import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  cleanupSVG,
  importDirectory,
  isEmptyColor,
  parseColors,
  runSVGO,
} from '@iconify/tools';
import type { IconifyJSON } from '@iconify/types';
import { getIcons, getIconsCSS, stringToIcon } from '@iconify/utils';

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
  const sorted: Record<string, string[]> = Object.create(null);
  icons.forEach((icon) => {
    const item = stringToIcon(icon);
    if (!item) return;
    const list = sorted[item.prefix] || (sorted[item.prefix] = []);
    if (!list.includes(item.name)) list.push(item.name);
  });
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
    await cleanupSVG(svg);
    if (source.monotone) {
      await parseColors(svg, {
        defaultColor: 'currentColor',
        callback: (attr, colorStr, color) =>
          !color || isEmptyColor(color) ? colorStr : 'currentColor',
      });
    }
    await runSVGO(svg);
  } catch (err) {
    console.error(`Error parsing ${name} from ${source.dir}:`, err);
    iconSet.remove(name);
    return;
  }
  iconSet.fromSVG(name, svg);
}

const sources: BundleScriptConfig = {
  svg: [],
  icons: [],
  json: [
    require.resolve('@iconify-json/tabler/icons.json'),
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

const target = join(__dirname, 'icons.css');

(async function () {
  const dir = dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const allIcons: IconifyJSON[] = [];

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

  if (sources.json) {
    for (const item of sources.json) {
      const filename = typeof item === 'string' ? item : item.filename;
      const content = JSON.parse(
        await fs.readFile(filename, 'utf8')
      ) as IconifyJSON;
      if (content.prefix === 'tabler') {
        for (const key in content.icons) {
          content.icons[key].body = content.icons[key].body.replace(
            /stroke-width="2"/g,
            'stroke-width="1.5"'
          );
        }
      }
      if (typeof item !== 'string' && item.icons?.length) {
        const filtered = getIcons(content, item.icons);
        if (!filtered)
          throw new Error(`Cannot find required icons in ${filename}`);
        allIcons.push(filtered);
      } else {
        allIcons.push(content);
      }
    }
  }

  if (sources.svg) {
    for (const source of sources.svg) {
      const iconSet = await importDirectory(source.dir, {
        prefix: source.prefix,
      });
      await iconSet.forEach((name, type) =>
        processSVGIcon(name, type, source, iconSet)
      );
      allIcons.push(iconSet.export());
    }
  }

  const cssContent = allIcons
    .map((iconSet) =>
      getIconsCSS(iconSet, Object.keys(iconSet.icons), {
        iconSelector: '.{prefix}-{name}',
        mode: 'mask',
      })
    )
    .join('\n');

  await fs.writeFile(target, cssContent, 'utf8');
  console.log(`Saved CSS to ${target}!`);
})().catch((err) => {
  console.error(err);
});
