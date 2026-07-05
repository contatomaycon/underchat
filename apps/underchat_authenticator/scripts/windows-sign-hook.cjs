const { execFileSync, spawnSync } = require('node:child_process');
const { chmodSync, existsSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');
const bundledSignToolPath = resolve(
  appRoot,
  '../../node_modules/electron-winstaller/vendor/signtool.exe'
);
const winePrefix = resolve(appRoot, 'build/wine-prefix');
const wineRuntimeDir = resolve(appRoot, 'build/wine-runtime');

function commandExists(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {
    stdio: 'ignore',
  });

  return result.status === 0;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function ensureWineEnv() {
  mkdirSync(winePrefix, { recursive: true });
  mkdirSync(wineRuntimeDir, { recursive: true });
  chmodSync(wineRuntimeDir, 0o700);

  return {
    ...process.env,
    WINEPREFIX: winePrefix,
    XDG_RUNTIME_DIR: wineRuntimeDir,
  };
}

function toWinePath(path, env) {
  try {
    return execFileSync('winepath', ['-w', path], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return `Z:${path.replace(/\//g, '\\')}`;
  }
}

function maybeConvertWinePath(arg, env) {
  if (arg.startsWith('/')) {
    return existsSync(arg) ? toWinePath(arg, env) : arg;
  }

  const absolutePath = resolve(appRoot, arg);
  return existsSync(absolutePath) ? toWinePath(absolutePath, env) : arg;
}

module.exports = async function signWithLocalWindowsTool(configuration) {
  const osslsigncodePath =
    process.env.ELECTRON_BUILDER_OSSL_SIGNCODE_PATH ||
    (commandExists('osslsigncode') ? 'osslsigncode' : null);

  if (osslsigncodePath) {
    run(osslsigncodePath, configuration.computeSignToolArgs(false));
    return;
  }

  if (process.env.UNDERCHAT_USE_WINE_SIGNTOOL === 'true') {
    if (!existsSync(bundledSignToolPath)) {
      throw new Error(
        `Bundled signtool.exe was not found: ${bundledSignToolPath}`
      );
    }

    const wineEnv = ensureWineEnv();
    const args = configuration
      .computeSignToolArgs(true)
      .map((arg) => maybeConvertWinePath(arg, wineEnv));
    run('wine', [bundledSignToolPath, ...args], wineEnv);
    return;
  }

  throw new Error(
    [
      'Windows signing requires osslsigncode in this Linux environment.',
      'Install osslsigncode, set ELECTRON_BUILDER_OSSL_SIGNCODE_PATH,',
      'or set UNDERCHAT_USE_WINE_SIGNTOOL=true to try the bundled signtool.exe through Wine.',
    ].join(' ')
  );
};
