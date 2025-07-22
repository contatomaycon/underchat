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
  await fs.mkdir(dir, {
    recursive: true,
  });

  const allIcons: IconifyJSON[] = [];

  if (sources.icons) {
    const sourcesJSON = sources.json ? sources.json : (sources.json = []);
    const organizedList = organizeIconsList(sources.icons);

    for (const prefix in organizedList) {
      const filename = require.resolve(`@iconify/json/json/${prefix}.json`);

      sourcesJSON.push({
        filename,
        icons: organizedList[prefix],
      });
    }
  }

  /**
   * Bundle JSON files and collect icons
   */
  if (sources.json) {
    for (let i = 0; i < sources.json.length; i++) {
      const item = sources.json[i];

      // Load icon set
      const filename = typeof item === 'string' ? item : item.filename;
      const content = JSON.parse(
        await fs.readFile(filename, 'utf8')
      ) as IconifyJSON;

      for (const key in content) {
        if (key === 'prefix' && content.prefix === 'tabler') {
          for (const k in content.icons)
            content.icons[k].body = content.icons[k].body.replace(
              /stroke-width="2"/g,
              'stroke-width="1.5"'
            );
        }
      }

      // Filter icons
      if (typeof item !== 'string' && item.icons?.length) {
        const filteredContent = getIcons(content, item.icons);

        if (!filteredContent)
          throw new Error(`Cannot find required icons in ${filename}`);

        // Collect filtered icons
        allIcons.push(filteredContent);
      } else {
        // Collect all icons from the JSON file
        allIcons.push(content);
      }
    }
  }

  /**
   * Bundle custom SVG icons and collect icons
   */
  if (sources.svg) {
    for (let i = 0; i < sources.svg.length; i++) {
      const source = sources.svg[i];

      // Import icons
      const iconSet = await importDirectory(source.dir, {
        prefix: source.prefix,
      });

      // Validate, clean up, fix palette, etc.
      await iconSet.forEach(async (name, type) => {
        if (type !== 'icon') return;

        // Get SVG instance for parsing
        const svg = iconSet.toSVG(name);

        if (!svg) {
          // Invalid icon
          iconSet.remove(name);

          return;
        }

        // Clean up and optimise icons
        try {
          // Clean up icon code
          await cleanupSVG(svg);

          if (source.monotone) {
            // Replace color with currentColor, add if missing
            // If icon is not monotone, remove this code
            await parseColors(svg, {
              defaultColor: 'currentColor',
              callback: (attr, colorStr, color) => {
                return !color || isEmptyColor(color)
                  ? colorStr
                  : 'currentColor';
              },
            });
          }

          // Optimise
          await runSVGO(svg);
        } catch (err) {
          // Invalid icon
          console.error(`Error parsing ${name} from ${source.dir}:`, err);
          iconSet.remove(name);

          return;
        }

        // Update icon from SVG instance
        iconSet.fromSVG(name, svg);
      });

      // Collect the SVG icon
      allIcons.push(iconSet.export());
    }
  }

  // Generate CSS from collected icons
  const cssContent = allIcons
    .map((iconSet) =>
      getIconsCSS(iconSet, Object.keys(iconSet.icons), {
        iconSelector: '.{prefix}-{name}',
        mode: 'mask',
      })
    )
    .join('\n');

  // Save the CSS to a file
  await fs.writeFile(target, cssContent, 'utf8');

  console.log(`Saved CSS to ${target}!`);
})().catch((err) => {
  console.error(err);
});

/**
 * Sort icon names by prefix
 */
function organizeIconsList(icons: string[]): Record<string, string[]> {
  const sorted: Record<string, string[]> = Object.create(null);

  icons.forEach((icon) => {
    const item = stringToIcon(icon);

    if (!item) return;

    const prefix = item.prefix;
    const prefixList = sorted[prefix] ? sorted[prefix] : (sorted[prefix] = []);

    const name = item.name;

    if (!prefixList.includes(name)) prefixList.push(name);
  });

  return sorted;
}
