import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const channel = process.argv[2];
if (channel !== 'dev' && channel !== 'prod') {
  console.error('Uso: node scripts/package-extension.mjs <dev|prod>');
  process.exit(1);
}

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const version = packageJson.version || '1.0.0';
const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = resolve(appRoot, 'dist', channel);
const outputPath = resolve(
  appRoot,
  'release',
  channel,
  `underchat-chrome-extension-${channel}-${version}.zip`
);

const distStat = await stat(distDir).catch(() => null);
if (!distStat?.isDirectory()) {
  console.error(`Build não encontrado em ${distDir}. Rode build:${channel}.`);
  process.exit(1);
}

await mkdir(dirname(outputPath), { recursive: true });
await rm(outputPath, { force: true });

const result = spawnSync('zip', ['-qr', outputPath, '.'], {
  cwd: distDir,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Não foi possível executar zip: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Release gerado: ${outputPath}`);
