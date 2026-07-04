const { chmod, rename, stat, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const executableName = 'underchat-passkey-helper';
const realExecutableName = 'underchat-passkey-helper-bin';

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const appOutDir = context.appOutDir;
  const executablePath = join(appOutDir, executableName);
  const realExecutablePath = join(appOutDir, realExecutableName);

  const currentStat = await stat(executablePath).catch(() => null);

  if (!currentStat?.isFile()) {
    console.warn(
      '[passkey_helper] linux wrapper skipped: executable not found',
      {
        executablePath,
      }
    );
    return;
  }

  await rename(executablePath, realExecutablePath);
  await writeFile(
    executablePath,
    [
      '#!/bin/sh',
      'APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'unset WAYLAND_DISPLAY',
      'unset ELECTRON_RUN_AS_NODE',
      'unset ELECTRON_NO_ATTACH_CONSOLE',
      'export XDG_SESSION_TYPE=x11',
      'export GDK_BACKEND=x11',
      'export ELECTRON_OZONE_PLATFORM_HINT=x11',
      'exec "$APP_DIR/underchat-passkey-helper-bin" "$@"',
      '',
    ].join('\n')
  );
  await chmod(executablePath, 0o755);

  console.log('[passkey_helper] linux X11 wrapper installed', {
    executablePath,
    realExecutablePath,
  });
};
