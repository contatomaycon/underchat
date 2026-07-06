import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const appRoot = resolve(import.meta.dirname, '..');
const certDir = resolve(appRoot, 'build/certs');
const pfxPath = resolve(certDir, 'underchat-authenticator-self-signed.pfx');
const passwordPath = resolve(certDir, 'windows-codesign.password');
const electronCacheRoot = resolve(
  process.env.HOME ?? '/home/maycon',
  '.cache/electron'
);
const electronBuilderGlobalCacheRoot = resolve(
  process.env.HOME ?? '/home/maycon',
  '.cache/electron-builder'
);
const electronDistRoot = resolve(appRoot, 'build/electron');
const electronBuilderCacheRoot = resolve(
  appRoot,
  'build/electron-builder-cache'
);
const nsisTargetPath = resolve(
  appRoot,
  '../../node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js'
);
const args = process.argv.slice(2);
const explicitPlatformTarget = ['--win', '--linux', '--mac'].some((arg) =>
  args.includes(arg)
);
const shouldBuildWindows =
  args.includes('--win') ||
  (!explicitPlatformTarget && process.platform === 'win32');
const shouldBuildLinux =
  args.includes('--linux') ||
  (!explicitPlatformTarget && process.platform === 'linux');
const shouldBuildMac =
  args.includes('--mac') ||
  (!explicitPlatformTarget && process.platform === 'darwin');

async function exists(path) {
  return Boolean(await stat(path).catch(() => undefined));
}

async function findElectronZip(fileName) {
  const cacheEntries = await readdir(electronCacheRoot, {
    withFileTypes: true,
  }).catch(() => []);

  for (const entry of cacheEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = resolve(electronCacheRoot, entry.name, fileName);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function run(command, commandArgs) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: appRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function copyBuilderCacheEntry(entryName) {
  const source = resolve(electronBuilderGlobalCacheRoot, entryName);
  const target = resolve(electronBuilderCacheRoot, entryName);

  if (!(await exists(source)) || (await exists(target))) {
    return;
  }

  await mkdir(electronBuilderCacheRoot, { recursive: true });
  await cp(source, target, {
    recursive: true,
    verbatimSymlinks: true,
  });
}

async function prepareWindowsBuilderCache() {
  await Promise.all([
    copyBuilderCacheEntry('7zip@1.0.0'),
    copyBuilderCacheEntry('nsis-3.0.4.1'),
    copyBuilderCacheEntry('nsis-resources-3.4.1'),
  ]);
}

async function patchElectronBuilderNsisUninstallerReader() {
  const source = await readFile(nsisTargetPath, 'utf8').catch(() => null);
  if (!source || source.includes('Underchat native uninstaller extraction')) {
    return;
  }

  const wineBlock = `        else {
            const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
            await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }`;
  const nativeFirstBlock = `        else {
            try {
                // Underchat native uninstaller extraction: avoids Wine on sandboxed Linux builds.
                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
            }
            catch (error) {
                builder_util_1.log.warn(\`Wine fallback is used for uninstaller extraction: \${error.message}\`);
                const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
                await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
            }
        }`;

  if (!source.includes(wineBlock)) {
    console.warn(
      '[underchat_authenticator] electron-builder NSIS Wine block was not found; skipping uninstaller reader patch.'
    );
    return;
  }

  await writeFile(nsisTargetPath, source.replace(wineBlock, nativeFirstBlock));
  console.log(
    '[underchat_authenticator] electron-builder NSIS uninstaller patch applied'
  );
}

async function prepareElectronDist(platformTag) {
  const packageJson = JSON.parse(
    await readFile(resolve(appRoot, 'package.json'), 'utf8')
  );
  const electronVersion = String(
    packageJson.devDependencies?.electron ?? ''
  ).replace(/^[^\d]*/, '');

  if (!electronVersion) {
    return null;
  }

  const fileName = `electron-v${electronVersion}-${platformTag}.zip`;
  const cacheZip = await findElectronZip(fileName);
  if (!cacheZip) {
    console.warn(
      '[underchat_authenticator] Electron ZIP was not found in cache',
      {
        fileName,
        cache: electronCacheRoot,
      }
    );
    return null;
  }

  const outputDir = resolve(electronDistRoot, platformTag);
  const markerPath = resolve(outputDir, '.underchat-electron-dist');
  if (await exists(markerPath)) {
    return outputDir;
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await run('unzip', ['-q', cacheZip, '-d', outputDir]);
  await writeFile(markerPath, `${fileName}\n`);

  console.log(
    '[underchat_authenticator] Electron distribution prepared from cache',
    {
      platform: platformTag,
      source: cacheZip,
      electronDist: outputDir,
    }
  );

  return outputDir;
}

function hasConfigOverride(configKey) {
  return args.some(
    (arg) =>
      arg === `--config.${configKey}` ||
      arg.startsWith(`--config.${configKey}=`)
  );
}

function hasMacNotarizationCredentials(env) {
  return (
    Boolean(
      env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER
    ) ||
    Boolean(
      env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID
    ) ||
    Boolean(env.APPLE_KEYCHAIN && env.APPLE_KEYCHAIN_PROFILE)
  );
}

function exitWithConfigurationError(message) {
  console.error(`[underchat_authenticator] ${message}`);
  process.exit(1);
}

function configureMacPackaging(env) {
  if (!shouldBuildMac) {
    return;
  }

  if (process.platform !== 'darwin') {
    exitWithConfigurationError(
      'macOS packaging must run on macOS because DMG creation, Developer ID signing, and notarization require Apple tooling.'
    );
  }

  if (env.UNDERCHAT_REQUIRE_MAC_SIGNING === 'true') {
    if (!hasMacNotarizationCredentials(env)) {
      exitWithConfigurationError(
        [
          'macOS production packaging requires Apple notarization credentials.',
          'Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER; or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID; or APPLE_KEYCHAIN and APPLE_KEYCHAIN_PROFILE.',
        ].join(' ')
      );
    }

    console.log(
      '[underchat_authenticator] macOS signing and notarization enabled'
    );
    return;
  }

  if (!hasConfigOverride('mac.identity')) {
    args.push('--config.mac.identity=null');
  }

  if (!hasConfigOverride('mac.notarize')) {
    args.push('--config.mac.notarize=false');
  }

  if (!hasConfigOverride('mac.hardenedRuntime')) {
    args.push('--config.mac.hardenedRuntime=false');
  }

  env.CSC_IDENTITY_AUTO_DISCOVERY = env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false';
  console.warn(
    '[underchat_authenticator] macOS development package will be unsigned and not notarized; Gatekeeper may require manual approval.'
  );
}

const env = { ...process.env };
env.npm_config_user_agent = `traversal/1.0.0 node/${process.version}`;
env.npm_execpath = 'traversal';
if (env.UNDERCHAT_USE_LOCAL_BUILDER_CACHE === 'true') {
  env.ELECTRON_BUILDER_CACHE =
    env.ELECTRON_BUILDER_CACHE ?? electronBuilderCacheRoot;
}
const hasExplicitElectronDist = args.some((arg) =>
  arg.startsWith('--config.electronDist')
);

configureMacPackaging(env);

if (shouldBuildWindows) {
  env.ELECTRON_BUILDER_OFFLINE = env.ELECTRON_BUILDER_OFFLINE ?? 'true';
  env.ELECTRON_BUILDER_CACHE =
    env.ELECTRON_BUILDER_CACHE ?? electronBuilderCacheRoot;
  await prepareWindowsBuilderCache();
  await patchElectronBuilderNsisUninstallerReader();

  if ((await exists(pfxPath)) && (await exists(passwordPath))) {
    env.CSC_LINK = pfxPath;
    env.CSC_KEY_PASSWORD = (await readFile(passwordPath, 'utf8')).trim();
    env.WIN_CSC_LINK = pfxPath;
    env.WIN_CSC_KEY_PASSWORD = env.CSC_KEY_PASSWORD;
    console.log('[underchat_authenticator] Windows code signing enabled', {
      certificate: pfxPath,
    });
  } else {
    console.warn(
      '[underchat_authenticator] Windows code signing certificate was not found; build will continue unsigned.'
    );
  }
}

if (!hasExplicitElectronDist) {
  const platformTag = shouldBuildWindows
    ? 'win32-x64'
    : shouldBuildLinux
      ? 'linux-x64'
      : null;
  const electronDist = platformTag
    ? await prepareElectronDist(platformTag)
    : null;

  if (electronDist) {
    args.push(`--config.electronDist=${electronDist}`);
  }
}

await new Promise((resolvePromise, reject) => {
  const child = spawn('electron-builder', args, {
    cwd: appRoot,
    env,
    stdio: 'inherit',
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolvePromise();
      return;
    }

    reject(new Error(`electron-builder exited with code ${code}`));
  });
});
