import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '..');
const managerDownloadRoot = resolve(
  appRoot,
  '../manager_api/downloads/underchat-authenticator'
);
const supportedExtensions = new Set(['.AppImage', '.blockmap', '.deb', '.exe']);

function parseChannel() {
  const channelIndex = process.argv.indexOf('--channel');
  const channel =
    channelIndex >= 0 ? process.argv[channelIndex + 1] : process.env.CHANNEL;

  if (channel !== 'dev' && channel !== 'prod') {
    throw new Error('Use --channel dev ou --channel prod.');
  }

  return channel;
}

const channel = parseChannel();
const releaseDir = resolve(appRoot, 'release', channel);
const targetDir = resolve(managerDownloadRoot, channel);

const entries = await readdir(releaseDir, { withFileTypes: true });
const artifacts = entries
  .filter((entry) => entry.isFile())
  .filter((entry) => supportedExtensions.has(extname(entry.name)))
  .filter((entry) => entry.name.startsWith('Underchat-Authenticator-'));

await mkdir(targetDir, { recursive: true });

for (const artifact of artifacts) {
  const source = resolve(releaseDir, artifact.name);
  const target = resolve(targetDir, artifact.name);
  const fileStat = await stat(source);

  await copyFile(source, target);

  console.log('[underchat_authenticator] manager download artifact synced', {
    channel,
    file: artifact.name,
    size: fileStat.size,
    target,
  });
}

if (artifacts.length === 0) {
  console.warn('[underchat_authenticator] no artifacts found to sync', {
    channel,
    releaseDir,
  });
}
