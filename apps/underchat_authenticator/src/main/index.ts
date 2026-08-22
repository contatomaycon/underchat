import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { exportCanonicalSessionProjection } from '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js';
import {
  buildSecureSessionPackage,
  extractWhatsAppWebAuthDump,
  readWhatsAppPageContext,
  readWhatsAppReadiness,
  targetProviderForWorkerType,
  type WhatsAppPageContext,
  type WhatsAppWebAuthDump,
  type WwebjsCanonicalProjection,
} from '@underchat/whatsapp-web-session-browser';

import {
  AuthenticatorApiClient,
  type AuthenticatorActionResult,
  type AuthenticatorSession,
  type SecureSessionPackage,
} from './apiClient';
import {
  extractDeepLinkFromArgv,
  parseAuthenticatorDeepLink,
  AUTHENTICATOR_PROTOCOL,
  sanitizeError,
  type AuthenticatorDeepLinkContext,
} from './deepLink';

declare const __UNDERCHAT_AUTHENTICATOR_CHANNEL__: string;

const appMainDir = import.meta.dirname;
const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const WWEBJS_PROFILE_MAX_BYTES = 80 * 1024 * 1024;
const WWEBJS_CANONICAL_MAX_BYTES = 64 * 1024 * 1024;
const WWEBJS_CANONICAL_MAX_RECORDS = 200_000;
const WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS = 45_000;
const WWEBJS_PROFILE_INCLUDE_ROOT_ENTRIES = new Set([
  'Cookies',
  'Cookies-journal',
  'IndexedDB',
  'Local Storage',
  'Network',
  'Network Persistent State',
  'Preferences',
  'Service Worker',
  'Session Storage',
  'Shared Dictionary',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'WebStorage',
  'blob_storage',
]);
const WWEBJS_PROFILE_SKIP_FILE_NAMES = new Set([
  'LOCK',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'DevToolsActivePort',
]);
const CONTROLLED_BROWSER_PROFILE_DIR = 'ControlledBrowser';
const CONTROLLED_BROWSER_DEVTOOLS_TIMEOUT_MS = 20_000;
const CONTROLLED_BROWSER_TARGET_TIMEOUT_MS = 45_000;
const CONTROLLED_BROWSER_HANDOFF_TIMEOUT_MS = 10 * 60_000;
const CONTROLLED_BROWSER_HANDOFF_POLL_MS = 2_000;
const CONTROLLED_BROWSER_STABLE_WINDOW_MS = 30_000;
const CONTROLLED_BROWSER_CLOSE_CDP_TIMEOUT_MS = 2_000;
const CONTROLLED_BROWSER_EXIT_TIMEOUT_MS = 6_000;
const SECURE_SESSION_TERMINAL_STATUSES = new Set([
  'connected_confirmed',
  'failed',
  'expired',
  'cancelled',
]);
const SECURE_SESSION_HELPER_CANCELLABLE_STATUSES = new Set([
  'created',
  'helper_opened',
  'wa_authenticated',
  'wa_syncing',
  'wa_ready',
]);
const isDevelopment = !app.isPackaged;
const authenticatorBuildChannel = __UNDERCHAT_AUTHENTICATOR_CHANNEL__;
const diagnosticsEnabled = authenticatorBuildChannel === 'dev' || isDevelopment;

interface CurrentPairing {
  context: AuthenticatorDeepLinkContext;
  error: string | null;
  session: AuthenticatorSession | null;
}

type SecureSessionProfileFile = {
  data: string;
  encoding: 'base64';
};

type SecureSessionProfileFiles = Record<string, SecureSessionProfileFile>;
type JsonRecord = Record<string, unknown>;
type ControlledBrowserKind = 'chrome';
type ControlledBrowserInfo = {
  executablePath: string;
  kind: ControlledBrowserKind;
  name: string;
  version?: string | null;
};
type ControlledBrowserInstance = ControlledBrowserInfo & {
  child: ChildProcess;
  debugPort: number;
  profileRoot: string;
  webSocketPath: string;
};
type CdpTarget = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};
type CdpEvaluationResult<T = unknown> = {
  exceptionDetails?: unknown;
  result?: {
    description?: string;
    subtype?: string;
    type?: string;
    value?: T;
  };
};
type ControlledBrowserPageContext = WhatsAppPageContext;
type WhatsAppReadinessSnapshot = {
  authenticated: boolean;
  hasBlockingLoginUi: boolean;
  hasChatUi: boolean;
  readyForHandoff: boolean;
  reason: string;
  syncing: boolean;
};
type DiagnosticLogEntry = {
  details: Record<string, unknown>;
  event: string;
  timestamp: string;
  tokenHash?: string;
};

let mainWindow: BrowserWindow | null = null;
let currentPairing: CurrentPairing | null = null;
let localSessionClearInFlight: Promise<void> | null = null;
let localSessionClearedTokenHash: string | null = null;
let connectedCleanupCloseTimer: NodeJS.Timeout | null = null;
let allowMainWindowClose = false;
let closeCleanupInFlight: Promise<void> | null = null;
let activeControlledBrowser: ControlledBrowserInstance | null = null;
let controlledBrowserFlowInFlight: Promise<AuthenticatorActionResult> | null =
  null;
const diagnosticLogEntries: DiagnosticLogEntry[] = [];
const MAX_DIAGNOSTIC_LOG_ENTRIES = 5000;

const apiClient = new AuthenticatorApiClient((event, context, details = {}) => {
  logEvent(event, context, details);
});

app.setName('Underchat Authenticator');
app.setPath(
  'userData',
  process.platform === 'linux'
    ? join(app.getPath('appData'), 'underchat-authenticator')
    : join(app.getPath('appData'), 'Underchat Authenticator')
);
configureRuntimeSwitches();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  console.log('[underchat-authenticator] single_instance.lock_denied', {
    argvCount: process.argv.length,
    hasDeepLink: Boolean(extractDeepLinkFromArgv(process.argv)),
  });
  app.exit(0);
} else {
  registerProtocol();
  registerIpcHandlers();
  registerAppLifecycleHandlers();
}

function registerProtocol(): void {
  if (process.platform === 'linux') {
    console.log('[underchat-authenticator] protocol.register.skipped_linux', {
      protocol: AUTHENTICATOR_PROTOCOL,
    });
    return;
  }

  if (process.defaultApp && process.argv.length >= 2) {
    const entrypoint = getDefaultAppProtocolEntrypoint();

    if (entrypoint) {
      app.setAsDefaultProtocolClient(AUTHENTICATOR_PROTOCOL, process.execPath, [
        resolve(entrypoint),
      ]);
      console.log('[underchat-authenticator] protocol.register.default_app', {
        protocol: AUTHENTICATOR_PROTOCOL,
      });
    }

    return;
  }

  app.setAsDefaultProtocolClient(AUTHENTICATOR_PROTOCOL);
  console.log('[underchat-authenticator] protocol.register.packaged', {
    protocol: AUTHENTICATOR_PROTOCOL,
  });
}

function configureRuntimeSwitches(): void {
  if (process.platform !== 'linux') {
    return;
  }

  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-vulkan');
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
  console.log('[underchat-authenticator] runtime.switches.linux', {
    disableGpu: true,
    disableVulkan: true,
    ozonePlatform: 'x11',
  });
}

function getDefaultAppProtocolEntrypoint(): string | null {
  for (const arg of process.argv.slice(1)) {
    if (
      arg.startsWith('-') ||
      arg.startsWith(`${AUTHENTICATOR_PROTOCOL}://`) ||
      arg.startsWith('--deep-link=')
    ) {
      continue;
    }

    return arg;
  }

  return null;
}

function registerAppLifecycleHandlers(): void {
  app.on('second-instance', (_event, argv) => {
    const deepLink = extractDeepLinkFromArgv(argv);

    console.log('[underchat-authenticator] second_instance.received', {
      argvCount: argv.length,
      hasDeepLink: Boolean(deepLink),
    });

    if (deepLink) {
      void handleDeepLink(deepLink);
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleDeepLink(url);
  });

  app.whenReady().then(async () => {
    const initialDeepLink = extractDeepLinkFromArgv(process.argv);

    console.log('[underchat-authenticator] app.ready', {
      argvCount: process.argv.length,
      hasDeepLink: Boolean(initialDeepLink),
      isPackaged: app.isPackaged,
      platform: process.platform,
    });

    if (initialDeepLink) {
      await handleDeepLink(initialDeepLink);
      return;
    }

    createMainWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('before-quit', (event) => {
    if (
      allowMainWindowClose ||
      closeCleanupInFlight ||
      !mainWindow ||
      mainWindow.isDestroyed()
    ) {
      return;
    }

    event.preventDefault();
    void closeHelperAfterCleanup('app_before_quit');
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('underchat-authenticator:get-diagnostics-info', async () => ({
    channel: authenticatorBuildChannel,
    enabled: diagnosticsEnabled,
  }));

  ipcMain.handle(
    'underchat-authenticator:append-debug-log',
    async (
      _event,
      input: {
        details?: Record<string, unknown>;
        event?: string;
      }
    ) => {
      logEvent(
        `renderer.${input.event || 'event'}`,
        currentPairing?.context,
        input.details ?? {}
      );
      return { status: 'ok' };
    }
  );

  ipcMain.handle('underchat-authenticator:download-debug-log', async () => {
    if (!diagnosticsEnabled) {
      return {
        message: 'Log de diagnóstico disponível apenas no release dev.',
        status: 'disabled',
      };
    }

    return saveDiagnosticLog();
  });

  ipcMain.handle('underchat-authenticator:close-helper', async () => {
    logEvent('helper.close.requested', currentPairing?.context, {
      status: normalizeSessionStatus(currentPairing?.session ?? null),
    });

    await closeHelperAfterCleanup('helper_close_requested');

    return {
      connected: true,
      status:
        normalizeSessionStatus(currentPairing?.session ?? null) ?? 'closing',
    };
  });

  ipcMain.handle('underchat-authenticator:get-session', async () => {
    if (!currentPairing) {
      return {
        error:
          'Abra o Underchat Authenticator pelo link da Underchat para iniciar a verificação.',
      };
    }

    if (currentPairing.error) {
      return {
        apiBaseUrl: currentPairing.context.apiBaseUrl,
        error: currentPairing.error,
        mode: currentPairing.context.mode,
        tokenHash: currentPairing.context.tokenHash,
      };
    }

    if (currentPairing.context.mode === 'secure') {
      currentPairing.session = await fetchPairingSession(
        currentPairing.context
      );
    } else if (!currentPairing.session) {
      currentPairing.session = await fetchPairingSession(
        currentPairing.context
      );
    }

    return {
      apiBaseUrl: currentPairing.context.apiBaseUrl,
      mode: currentPairing.context.mode,
      session: currentPairing.session,
      tokenHash: currentPairing.context.tokenHash,
    };
  });

  ipcMain.handle(
    'underchat-authenticator:start-controlled-browser',
    async () => {
      if (!currentPairing) {
        throw new Error('Sessão segura não iniciada.');
      }

      if (controlledBrowserFlowInFlight) {
        logEvent(
          'secure_session.controlled_browser.start.skipped',
          currentPairing.context,
          {
            reason: 'already_in_flight',
          }
        );
        return {
          message:
            'O Google Chrome controlado já está aberto para esta verificação.',
          status: 'already_running',
        };
      }

      controlledBrowserFlowInFlight = runControlledBrowserSecureSession()
        .catch((error) => {
          const message = sanitizeError(error);
          logEvent(
            'secure_session.controlled_browser.flow.error',
            currentPairing?.context,
            {
              reason: message,
            }
          );
          throw error;
        })
        .finally(() => {
          controlledBrowserFlowInFlight = null;
        });

      return controlledBrowserFlowInFlight;
    }
  );

  ipcMain.handle(
    'underchat-authenticator:update-secure-status',
    async (
      _event,
      statusPayload: {
        error?: string;
        message?: string;
        status: string;
      }
    ) => {
      return updateSecureStatusFromMain(statusPayload);
    }
  );

  ipcMain.handle(
    'underchat-authenticator:open-chrome-download-page',
    async () => {
      await shell.openExternal('https://www.google.com/chrome/');
      return { status: 'opened' };
    }
  );
}

function normalizeSessionStatus(
  session: AuthenticatorSession | null
): string | null {
  if (session?.status === undefined || session.status === null) {
    return null;
  }

  return String(session.status);
}

function normalizeActionStatus(status: unknown): string | null {
  if (status === undefined || status === null) {
    return null;
  }

  return String(status);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function updateSecureStatusFromMain(statusPayload: {
  error?: string;
  message?: string;
  status: string;
}): Promise<AuthenticatorActionResult> {
  if (!currentPairing) {
    throw new Error('Sessão segura não iniciada.');
  }

  const previousStatus = normalizeSessionStatus(currentPairing.session);
  logEvent('secure_session.status.update.start', currentPairing.context, {
    previous_status: previousStatus,
    requested_status: statusPayload.status,
  });
  const result = await apiClient.updateSecureStatus(currentPairing.context, {
    ...statusPayload,
    helper_platform: process.platform,
    helper_version: app.getVersion(),
  });
  currentPairing.session = await fetchPairingSession(
    currentPairing.context
  ).catch(() => currentPairing?.session ?? null);
  const nextStatus =
    normalizeSessionStatus(currentPairing.session) ??
    normalizeActionStatus(result.status);

  if (nextStatus !== previousStatus) {
    mainWindow?.webContents.send('underchat-authenticator:session-updated');
  } else {
    logEvent(
      'secure_session.status.update.no_session_event',
      currentPairing.context,
      {
        status: nextStatus,
      }
    );
  }

  logEvent('secure_session.status.update.done', currentPairing.context, {
    next_status: nextStatus,
    previous_status: previousStatus,
    requested_status: statusPayload.status,
  });
  return result;
}

function assertSecureSessionStillActive(): void {
  const status = normalizeSessionStatus(currentPairing?.session ?? null);
  if (status && SECURE_SESSION_TERMINAL_STATUSES.has(status)) {
    throw new Error(`Sessão segura encerrada com status ${status}.`);
  }
}

async function runControlledBrowserSecureSession(): Promise<AuthenticatorActionResult> {
  const pairing = currentPairing;
  if (!pairing || pairing.context.mode !== 'secure') {
    throw new Error('Sessão segura não iniciada.');
  }

  await cleanupActiveControlledBrowser('controlled_browser_restart');
  pairing.session = await fetchPairingSession(pairing.context).catch(
    () => pairing.session
  );
  assertSecureSessionStillActive();

  const browser = await findControlledBrowser();
  logEvent(
    'secure_session.controlled_browser.browser.selected',
    pairing.context,
    {
      browser_kind: browser.kind,
      browser_name: browser.name,
      browser_path: browser.executablePath,
      browser_version: browser.version ?? null,
    }
  );

  await updateSecureStatusFromMain({
    message:
      'Abrindo Google Chrome para concluir a passkey por smartphone ou tablet.',
    status: 'helper_opened',
  });
  assertSecureSessionStillActive();

  let instance: ControlledBrowserInstance | null = null;
  let pageSession: CdpSession | null = null;

  try {
    instance = await launchControlledBrowser(
      browser,
      pairing.context.tokenHash
    );
    const target = await waitForWhatsAppCdpTarget(instance);
    if (!target.webSocketDebuggerUrl) {
      throw new Error('O Google Chrome não expôs o alvo CDP do WhatsApp Web.');
    }

    pageSession = await CdpSession.connect(target.webSocketDebuggerUrl);
    await pageSession.send('Runtime.enable').catch(() => undefined);

    await waitForControlledBrowserHandoffReady(pageSession, instance);
    const sessionPackage = await collectControlledBrowserSecureSessionPackage(
      pageSession,
      instance
    );
    let uploadPackage = sessionPackage;

    await closeControlledBrowserProcess(
      instance,
      'controlled_browser_session_captured'
    );
    pageSession.close();
    pageSession = null;

    if (shouldIncludeWwebjsProfile(sessionPackage.target_provider)) {
      const wwebjsLocalAuthFiles =
        await collectControlledBrowserWwebjsLocalAuthProfileFiles(
          instance.profileRoot,
          sessionPackage.target_provider
        );
      if (wwebjsLocalAuthFiles) {
        const payload = isRecord(sessionPackage.payload)
          ? sessionPackage.payload
          : {};
        uploadPackage = {
          ...sessionPackage,
          payload: {
            ...payload,
            wwebjs_local_auth: {
              files: wwebjsLocalAuthFiles,
            },
          },
        };
      }
    }

    await updateSecureStatusFromMain({ status: 'uploading' });
    logEvent(
      'secure_session.controlled_browser.upload.start',
      pairing.context,
      {
        has_payload: uploadPackage.payload !== undefined,
        target_provider: uploadPackage.target_provider,
      }
    );
    const result = await apiClient.uploadSecureSession(
      pairing.context,
      uploadPackage
    );
    pairing.session = await fetchPairingSession(pairing.context).catch(
      () => pairing.session
    );
    const nextStatus = normalizeSessionStatus(pairing.session);
    if (nextStatus === 'connected_confirmed') {
      scheduleConnectedCleanupAndClose(
        'secure_session_controlled_browser_connected'
      );
    }
    mainWindow?.webContents.send('underchat-authenticator:session-updated');
    logEvent('secure_session.controlled_browser.upload.done', pairing.context, {
      next_status: nextStatus,
      status: result.status ?? null,
    });

    return result;
  } finally {
    pageSession?.close();
    if (instance) {
      await cleanupControlledBrowserInstance(
        instance,
        'controlled_browser_flow_finally'
      );
    }
  }
}

async function findControlledBrowser(): Promise<ControlledBrowserInfo> {
  const overridePath =
    process.env.UNDERCHAT_AUTHENTICATOR_BROWSER_PATH?.trim() ?? '';
  if (overridePath) {
    if (!(await pathExists(overridePath))) {
      throw new Error(
        'O caminho em UNDERCHAT_AUTHENTICATOR_BROWSER_PATH não existe. Ajuste o caminho ou instale o Google Chrome.'
      );
    }

    return {
      executablePath: overridePath,
      kind: 'chrome',
      name: 'Google Chrome',
      version: await readControlledBrowserVersion(overridePath),
    };
  }

  for (const candidate of getControlledBrowserCandidates()) {
    if (!(await pathExists(candidate.executablePath))) {
      continue;
    }

    return {
      ...candidate,
      version: await readControlledBrowserVersion(candidate.executablePath),
    };
  }

  throw new Error(
    'Google Chrome não encontrado. Instale o Chrome e tente novamente.'
  );
}

function getControlledBrowserCandidates(): ControlledBrowserInfo[] {
  const candidates: ControlledBrowserInfo[] = [];
  const addCandidate = (
    executablePath: string | undefined,
    kind: ControlledBrowserKind,
    name: string
  ) => {
    if (!executablePath) {
      return;
    }
    candidates.push({ executablePath, kind, name });
  };

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const localAppData = process.env.LOCALAPPDATA;

    addCandidate(
      programFiles
        ? join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      'chrome',
      'Google Chrome'
    );
    addCandidate(
      programFilesX86
        ? join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      'chrome',
      'Google Chrome'
    );
    addCandidate(
      localAppData
        ? join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      'chrome',
      'Google Chrome'
    );
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME;
    addCandidate(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'chrome',
      'Google Chrome'
    );
    addCandidate(
      home
        ? join(
            home,
            'Applications',
            'Google Chrome.app',
            'Contents',
            'MacOS',
            'Google Chrome'
          )
        : undefined,
      'chrome',
      'Google Chrome'
    );
  } else {
    ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].forEach(
      (executablePath) =>
        addCandidate(executablePath, 'chrome', 'Google Chrome')
    );
  }

  for (const executablePath of getPathExecutableCandidates([
    'google-chrome',
    'google-chrome-stable',
    'chrome',
  ])) {
    addCandidate(executablePath, 'chrome', 'Google Chrome');
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.executablePath.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getPathExecutableCandidates(names: string[]): string[] {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const extensions =
    process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const pathDirs = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((entry) => entry.trim());

  return pathDirs.flatMap((dir) =>
    names.flatMap((name) =>
      extensions.map((extension) => join(dir, `${name}${extension}`))
    )
  );
}

async function readControlledBrowserVersion(
  executablePath: string
): Promise<string | null> {
  return new Promise((resolveVersion) => {
    const child = spawn(executablePath, ['--version'], {
      windowsHide: true,
    });
    let output = '';
    let settled = false;
    const resolveOnce = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveVersion(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      resolveOnce(null);
    }, 3_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', () => resolveOnce(null));
    child.on('close', () => resolveOnce(output.trim() || null));
  });
}

async function launchControlledBrowser(
  browser: ControlledBrowserInfo,
  tokenHash: string
): Promise<ControlledBrowserInstance> {
  const profileRoot = join(
    app.getPath('userData'),
    CONTROLLED_BROWSER_PROFILE_DIR,
    sanitizeProfileKey(tokenHash)
  );
  await rm(profileRoot, { force: true, recursive: true });
  await mkdir(profileRoot, { recursive: true });

  const args = [
    `--user-data-dir=${profileRoot}`,
    '--profile-directory=Default',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    WHATSAPP_WEB_ORIGIN,
  ];

  logEvent(
    'secure_session.controlled_browser.launch.start',
    currentPairing?.context,
    {
      browser_kind: browser.kind,
      browser_name: browser.name,
      browser_path: browser.executablePath,
      profile_root: profileRoot,
    }
  );

  const child = spawn(browser.executablePath, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });
  let devTools: { port: number; webSocketPath: string };
  try {
    devTools = await waitForDevToolsActivePort(profileRoot, child);
  } catch (error) {
    child.kill();
    await waitForChildExit(child, 2_000).catch(() => false);
    await rm(profileRoot, { force: true, recursive: true }).catch(
      () => undefined
    );
    throw error;
  }
  const instance: ControlledBrowserInstance = {
    ...browser,
    child,
    debugPort: devTools.port,
    profileRoot,
    webSocketPath: devTools.webSocketPath,
  };
  activeControlledBrowser = instance;

  logEvent(
    'secure_session.controlled_browser.launch.done',
    currentPairing?.context,
    {
      browser_kind: browser.kind,
      debug_port: devTools.port,
      profile_root: profileRoot,
    }
  );

  return instance;
}

async function waitForDevToolsActivePort(
  profileRoot: string,
  child: ChildProcess
): Promise<{ port: number; webSocketPath: string }> {
  const activePortPath = join(profileRoot, 'DevToolsActivePort');
  const startedAt = Date.now();
  let spawnError: unknown = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  while (Date.now() - startedAt <= CONTROLLED_BROWSER_DEVTOOLS_TIMEOUT_MS) {
    if (spawnError) {
      throw spawnError;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Google Chrome encerrou antes de abrir o DevTools remoto (${child.exitCode ?? child.signalCode}).`
      );
    }

    const content = await readFile(activePortPath, 'utf8').catch(() => null);
    if (content) {
      const [portLine, webSocketPathLine] = content.trim().split(/\r?\n/);
      const port = Number(portLine);
      if (
        Number.isInteger(port) &&
        port > 0 &&
        webSocketPathLine?.startsWith('/devtools/')
      ) {
        return {
          port,
          webSocketPath: webSocketPathLine,
        };
      }
    }

    await sleep(250);
  }

  throw new Error(
    'Google Chrome abriu, mas não expôs a porta DevTools para controle.'
  );
}

async function waitForWhatsAppCdpTarget(
  instance: ControlledBrowserInstance
): Promise<CdpTarget> {
  const startedAt = Date.now();
  let lastTargets: CdpTarget[] = [];

  while (Date.now() - startedAt <= CONTROLLED_BROWSER_TARGET_TIMEOUT_MS) {
    lastTargets = await fetchCdpTargets(instance.debugPort).catch(() => []);
    const target = lastTargets.find(
      (candidate) =>
        candidate.type === 'page' &&
        typeof candidate.url === 'string' &&
        candidate.url.startsWith(WHATSAPP_WEB_ORIGIN) &&
        typeof candidate.webSocketDebuggerUrl === 'string'
    );
    if (target) {
      logEvent(
        'secure_session.controlled_browser.target.ready',
        currentPairing?.context,
        {
          browser_kind: instance.kind,
          domain: getSafeDomain(target.url ?? ''),
          title: target.title ?? null,
        }
      );
      return target;
    }

    await sleep(500);
  }

  logEvent(
    'secure_session.controlled_browser.target.timeout',
    currentPairing?.context,
    {
      browser_kind: instance.kind,
      targets: lastTargets.map((target) => ({
        domain: getSafeDomain(target.url ?? ''),
        type: target.type ?? null,
      })),
    }
  );
  throw new Error('Não consegui anexar ao WhatsApp Web no Google Chrome.');
}

async function fetchCdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`CDP target list retornou HTTP ${response.status}.`);
  }

  const targets = await response.json();
  return Array.isArray(targets) ? (targets as CdpTarget[]) : [];
}

async function waitForControlledBrowserHandoffReady(
  pageSession: CdpSession,
  instance: ControlledBrowserInstance
): Promise<WhatsAppReadinessSnapshot> {
  const startedAt = Date.now();
  let stableSince: number | null = null;
  let lastReadiness = createDefaultReadiness('waiting_for_chat_ui');
  let lastReportedStatus: string | null = null;

  while (Date.now() - startedAt <= CONTROLLED_BROWSER_HANDOFF_TIMEOUT_MS) {
    const evaluatedReadiness = await evaluateCdpFunction(
      pageSession,
      readWhatsAppReadiness,
      [],
      WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
      'Não foi possível verificar o estado do WhatsApp Web no Google Chrome.'
    );
    lastReadiness = normalizeWhatsAppReadinessSnapshot(evaluatedReadiness);

    if (lastReadiness.readyForHandoff) {
      stableSince ??= Date.now();
    } else {
      stableSince = null;
    }

    const stableElapsedMs = stableSince === null ? 0 : Date.now() - stableSince;
    const nextStatus = lastReadiness.authenticated
      ? lastReadiness.syncing
        ? 'wa_syncing'
        : lastReadiness.readyForHandoff
          ? 'wa_ready'
          : 'wa_authenticated'
      : 'helper_opened';

    if (nextStatus !== lastReportedStatus) {
      lastReportedStatus = nextStatus;
      await updateSecureStatusFromMain({
        message:
          nextStatus === 'helper_opened'
            ? 'Aguardando autenticação no Google Chrome.'
            : nextStatus === 'wa_syncing'
              ? 'WhatsApp Web autenticado no Google Chrome. Aguardando sincronização.'
              : nextStatus === 'wa_ready'
                ? 'WhatsApp Web pronto no Google Chrome.'
                : 'WhatsApp Web autenticado no Google Chrome.',
        status: nextStatus,
      }).catch((error) => {
        logEvent(
          'secure_session.controlled_browser.status_error',
          currentPairing?.context,
          {
            reason: sanitizeError(error),
            status: nextStatus,
          }
        );
      });
    }
    assertSecureSessionStillActive();

    logEvent(
      'secure_session.controlled_browser.handoff_probe',
      currentPairing?.context,
      {
        authenticated: lastReadiness.authenticated,
        browser_kind: instance.kind,
        ready_for_handoff: lastReadiness.readyForHandoff,
        reason: lastReadiness.reason,
        stable_elapsed_ms: stableElapsedMs,
        syncing: lastReadiness.syncing,
      }
    );

    if (
      lastReadiness.readyForHandoff &&
      stableElapsedMs >= CONTROLLED_BROWSER_STABLE_WINDOW_MS
    ) {
      return lastReadiness;
    }

    await sleep(CONTROLLED_BROWSER_HANDOFF_POLL_MS);
  }

  throw new Error(
    lastReadiness.syncing
      ? 'O WhatsApp Web no Google Chrome ainda está sincronizando. Mantenha o app aberto nos dois dispositivos e tente novamente.'
      : 'O WhatsApp Web no Google Chrome ainda não ficou pronto para transferir a sessão.'
  );
}

async function collectControlledBrowserSecureSessionPackage(
  pageSession: CdpSession,
  instance: ControlledBrowserInstance
): Promise<SecureSessionPackage> {
  const targetProvider = getControlledBrowserTargetProvider();
  const pageContext = normalizeControlledBrowserPageContext(
    await evaluateCdpFunction(
      pageSession,
      readWhatsAppPageContext,
      [],
      WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
      'Não foi possível ler o contexto do WhatsApp Web no Google Chrome.'
    )
  );
  const authDump = normalizeWhatsAppWebAuthDump(
    await evaluateCdpFunction(
      pageSession,
      extractWhatsAppWebAuthDump,
      [],
      WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
      'Tempo excedido ao extrair a sessão canônica do WhatsApp Web no Google Chrome.'
    )
  );

  if (!authDump) {
    throw new Error(
      'O Google Chrome autenticou, mas não retornou o pacote de credenciais do WhatsApp Web.'
    );
  }

  const wwebjsCanonicalProjection =
    targetProvider === 'wwebjs'
      ? ((await evaluateCdpFunction(
          pageSession,
          exportCanonicalSessionProjection,
          [
            {
              capturedAdvSecret: authDump.creds.advSecretKey,
              maxBytes: WWEBJS_CANONICAL_MAX_BYTES,
              maxRecords: WWEBJS_CANONICAL_MAX_RECORDS,
            },
          ],
          WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
          'Tempo excedido ao gerar a projeção canônica do WWebJS no Google Chrome.'
        )) as WwebjsCanonicalProjection)
      : undefined;

  logEvent(
    'secure_session.controlled_browser.package.collect.done',
    currentPairing?.context,
    {
      auth_dump: summarizeAuthDump(authDump),
      browser_kind: instance.kind,
      canonical_projection_complete:
        wwebjsCanonicalProjection?.complete ?? null,
      indexed_db_count: pageContext.indexedDbNames.length,
      target_provider: targetProvider,
    }
  );

  const sessionPackage = buildSecureSessionPackage({
    authDump,
    pageContext,
    sourceClient: {
      kind: 'underchat_authenticator',
      platform: process.platform,
      version: app.getVersion(),
    },
    targetProvider,
    wwebjsCanonicalProjection,
  });
  const payload = isRecord(sessionPackage.payload)
    ? sessionPackage.payload
    : {};

  return {
    ...sessionPackage,
    payload: {
      ...payload,
      controlled_browser: {
        kind: instance.kind,
        name: instance.name,
        version: instance.version ?? null,
      },
    },
  };
}

async function collectControlledBrowserWwebjsLocalAuthProfileFiles(
  profileRoot: string,
  targetProvider: SecureSessionPackage['target_provider']
): Promise<SecureSessionProfileFiles | null> {
  if (!shouldIncludeWwebjsProfile(targetProvider)) {
    return null;
  }

  const defaultProfileRoot = join(profileRoot, 'Default');
  const files: SecureSessionProfileFiles = {};
  const budget = { totalBytes: 0 };

  for (const entryName of WWEBJS_PROFILE_INCLUDE_ROOT_ENTRIES) {
    const entryPath = join(defaultProfileRoot, entryName);
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat) {
      continue;
    }

    if (entryStat.isDirectory()) {
      await collectProfileEntryFiles({
        budget,
        files,
        profileRoot: defaultProfileRoot,
        targetPath: entryPath,
      });
      continue;
    }

    if (entryStat.isFile()) {
      await addProfileFile({
        budget,
        files,
        profileRoot: defaultProfileRoot,
        targetPath: entryPath,
      });
    }
  }

  const localStatePath = join(profileRoot, 'Local State');
  if (await stat(localStatePath).catch(() => null)) {
    await addProfileFile({
      budget,
      files,
      outputPrefix: '',
      profileRoot,
      targetPath: localStatePath,
    });
  }

  logEvent(
    'secure_session.controlled_browser.profile_export.done',
    currentPairing?.context,
    {
      file_count: Object.keys(files).length,
      total_bytes: budget.totalBytes,
      target_provider: targetProvider,
    }
  );

  return Object.keys(files).length ? files : null;
}

function shouldIncludeWwebjsProfile(
  targetProvider: SecureSessionPackage['target_provider']
): boolean {
  return targetProvider === 'wwebjs' || targetProvider === 'auto';
}

function getControlledBrowserTargetProvider(): SecureSessionPackage['target_provider'] {
  return targetProviderForWorkerType(currentPairing?.session?.worker_type_id);
}

function normalizeControlledBrowserPageContext(
  value: unknown
): ControlledBrowserPageContext {
  const pageContext = isRecord(value) ? value : {};
  const indexedDbNames = Array.isArray(pageContext.indexedDbNames)
    ? pageContext.indexedDbNames.filter(
        (name): name is string => typeof name === 'string' && Boolean(name)
      )
    : [];

  return {
    href:
      typeof pageContext.href === 'string'
        ? pageContext.href
        : WHATSAPP_WEB_ORIGIN,
    indexedDbNames,
    userAgent:
      typeof pageContext.userAgent === 'string'
        ? pageContext.userAgent
        : 'Google Chrome',
    webVersion:
      typeof pageContext.webVersion === 'string'
        ? pageContext.webVersion
        : undefined,
  };
}

function normalizeWhatsAppReadinessSnapshot(
  value: unknown
): WhatsAppReadinessSnapshot {
  if (!isRecord(value)) {
    return createDefaultReadiness('invalid_readiness_snapshot');
  }

  return {
    authenticated: value.authenticated === true,
    hasBlockingLoginUi: value.hasBlockingLoginUi === true,
    hasChatUi: value.hasChatUi === true,
    readyForHandoff: value.readyForHandoff === true,
    reason: typeof value.reason === 'string' ? value.reason : 'unknown',
    syncing: value.syncing === true,
  };
}

function createDefaultReadiness(reason: string): WhatsAppReadinessSnapshot {
  return {
    authenticated: false,
    hasBlockingLoginUi: false,
    hasChatUi: false,
    readyForHandoff: false,
    reason,
    syncing: false,
  };
}

function normalizeWhatsAppWebAuthDump(
  value: unknown
): WhatsAppWebAuthDump | null {
  if (!isRecord(value) || !isRecord(value.creds)) {
    return null;
  }

  const creds = value.creds;
  if (
    !isRecord(creds.account) ||
    !isRecord(creds.me) ||
    !isRecord(creds.noiseKey) ||
    !isRecord(creds.signedIdentityKey) ||
    !isRecord(creds.signedPreKey) ||
    !isRecord(creds.signedPreKey.keyPair) ||
    typeof creds.me.id !== 'string' ||
    typeof creds.noiseKey.private !== 'string' ||
    typeof creds.noiseKey.public !== 'string' ||
    typeof creds.signedIdentityKey.private !== 'string' ||
    typeof creds.signedIdentityKey.public !== 'string' ||
    typeof creds.signedPreKey.signature !== 'string' ||
    typeof creds.registrationId !== 'number'
  ) {
    return null;
  }

  return value as WhatsAppWebAuthDump;
}

async function cleanupActiveControlledBrowser(reason: string): Promise<void> {
  const instance = activeControlledBrowser;
  if (!instance) {
    return;
  }

  await cleanupControlledBrowserInstance(instance, reason);
}

async function cleanupControlledBrowserInstance(
  instance: ControlledBrowserInstance,
  reason: string
): Promise<void> {
  await closeControlledBrowserProcess(instance, reason).catch((error) => {
    logEvent(
      'secure_session.controlled_browser.close.error',
      currentPairing?.context,
      {
        browser_kind: instance.kind,
        reason: sanitizeError(error),
      }
    );
  });

  await removeControlledBrowserProfile(instance, reason);

  if (activeControlledBrowser === instance) {
    activeControlledBrowser = null;
  }
}

async function closeControlledBrowserProcess(
  instance: ControlledBrowserInstance,
  reason: string
): Promise<void> {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
    return;
  }

  logEvent(
    'secure_session.controlled_browser.close.start',
    currentPairing?.context,
    {
      browser_kind: instance.kind,
      reason,
    }
  );

  const browserCdpUrl = `ws://127.0.0.1:${instance.debugPort}${instance.webSocketPath}`;
  const browserSession = await withTimeout(
    CdpSession.connect(browserCdpUrl),
    CONTROLLED_BROWSER_CLOSE_CDP_TIMEOUT_MS,
    'Tempo esgotado ao conectar ao Chrome para encerrá-lo.'
  ).catch(() => null);
  if (browserSession) {
    await withTimeout(
      browserSession.send('Browser.close'),
      CONTROLLED_BROWSER_CLOSE_CDP_TIMEOUT_MS,
      'Tempo esgotado ao solicitar o encerramento do Chrome.'
    ).catch(() => undefined);
    browserSession.close();
  }

  const exited = await waitForChildExit(
    instance.child,
    CONTROLLED_BROWSER_EXIT_TIMEOUT_MS
  );
  if (!exited) {
    instance.child.kill('SIGKILL');
    const forceExited = await waitForChildExit(instance.child, 2_000);
    if (!forceExited) {
      throw new Error(
        'Não foi possível encerrar o Chrome antes de transferir a sessão.'
      );
    }
  }

  logEvent(
    'secure_session.controlled_browser.close.done',
    currentPairing?.context,
    {
      browser_kind: instance.kind,
      reason,
    }
  );
}

async function removeControlledBrowserProfile(
  instance: ControlledBrowserInstance,
  reason: string
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(instance.profileRoot, { force: true, recursive: true });
      logEvent(
        'secure_session.controlled_browser.profile.removed',
        currentPairing?.context,
        {
          attempt,
          browser_kind: instance.kind,
          profile_root: instance.profileRoot,
          reason,
        }
      );
      return;
    } catch (error) {
      if (attempt >= 3) {
        logEvent(
          'secure_session.controlled_browser.profile.remove_error',
          currentPairing?.context,
          {
            attempt,
            browser_kind: instance.kind,
            profile_root: instance.profileRoot,
            reason: sanitizeError(error),
          }
        );
        return;
      }
      await sleep(500);
    }
  }
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      cleanup();
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolveExit(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('close', onExit);
    };
    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

async function evaluateCdpExpression<T>(
  session: CdpSession,
  expression: string,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  const response = await withTimeout(
    session.send<CdpEvaluationResult<T>>('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
    }),
    timeoutMs,
    timeoutMessage
  );

  if (response.exceptionDetails) {
    throw new Error(describeCdpException(response.exceptionDetails));
  }

  return response.result?.value as T;
}

async function evaluateCdpFunction<TArgs extends unknown[], TResult>(
  session: CdpSession,
  pageFunction: (...args: TArgs) => TResult,
  args: TArgs,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Awaited<TResult>> {
  const serializedArgs = args.map((argument) => {
    const serialized = JSON.stringify(argument);
    if (serialized === undefined) {
      throw new Error('cdp_function_argument_not_serializable');
    }
    return serialized;
  });
  const expression = `(${pageFunction.toString()})(${serializedArgs.join(',')})`;

  return evaluateCdpExpression<Awaited<TResult>>(
    session,
    expression,
    timeoutMs,
    timeoutMessage
  );
}

function describeCdpException(exceptionDetails: unknown): string {
  if (!isRecord(exceptionDetails)) {
    return 'O Google Chrome retornou erro ao executar CDP.';
  }

  const exception = isRecord(exceptionDetails.exception)
    ? exceptionDetails.exception
    : {};
  const description =
    typeof exception.description === 'string'
      ? exception.description
      : typeof exceptionDetails.text === 'string'
        ? exceptionDetails.text
        : null;
  return description ?? 'O Google Chrome retornou erro ao executar CDP.';
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

function sanitizeProfileKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'session';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      reject: (reason?: unknown) => void;
      resolve: (value: unknown) => void;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    this.socket.addEventListener('close', () => {
      this.rejectPending(new Error('Conexão CDP encerrada.'));
    });
    this.socket.addEventListener('error', () => {
      this.rejectPending(new Error('Erro na conexão CDP.'));
    });
  }

  static connect(url: string): Promise<CdpSession> {
    if (typeof WebSocket === 'undefined') {
      return Promise.reject(
        new Error('Runtime sem suporte a WebSocket para CDP.')
      );
    }

    return new Promise((resolveConnect, rejectConnect) => {
      const socket = new WebSocket(url);
      let settled = false;
      const fail = () => {
        if (settled) {
          return;
        }
        settled = true;
        rejectConnect(
          new Error('Não consegui conectar ao CDP do Google Chrome.')
        );
      };

      socket.addEventListener('open', () => {
        settled = true;
        resolveConnect(new CdpSession(socket));
      });
      socket.addEventListener('error', fail);
      socket.addEventListener('close', fail);
    });
  }

  send<T = unknown>(method: string, params: JsonRecord = {}): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Conexão CDP não está aberta.'));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        resolve: (value: unknown) => resolve(value as T),
      });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
        })
      );
    });
  }

  close(): void {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
    this.rejectPending(new Error('Conexão CDP encerrada.'));
  }

  private handleMessage(data: unknown): void {
    const text = stringifyWebSocketData(data);
    if (!text) {
      return;
    }

    let message: JsonRecord;
    try {
      message = JSON.parse(text) as JsonRecord;
    } catch {
      return;
    }

    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (isRecord(message.error)) {
      pending.reject(
        new Error(
          typeof message.error.message === 'string'
            ? message.error.message
            : 'CDP retornou erro.'
        )
      );
      return;
    }

    pending.resolve(message.result);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function stringifyWebSocketData(data: unknown): string | null {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return Buffer.from(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    ).toString('utf8');
  }

  return null;
}

function scheduleConnectedCleanupAndClose(reason: string): void {
  if (connectedCleanupCloseTimer) {
    return;
  }

  logEvent(
    'secure_session.connected_cleanup.scheduled',
    currentPairing?.context,
    {
      reason,
    }
  );

  connectedCleanupCloseTimer = setTimeout(() => {
    connectedCleanupCloseTimer = null;
    void Promise.allSettled([
      clearWhatsAppWebLocalSession(reason),
      cleanupActiveControlledBrowser(reason),
    ])
      .then((results) => {
        const failedSteps = results.filter(
          (result) => result.status === 'rejected'
        );
        if (failedSteps.length > 0) {
          logEvent(
            'secure_session.connected_cleanup.schedule_error',
            currentPairing?.context,
            {
              failed_steps: failedSteps.length,
            }
          );
        }
      })
      .finally(() => {
        closeMainWindowAndQuit();
      });
  }, 2200);
}

async function closeHelperAfterCleanup(reason: string): Promise<void> {
  if (closeCleanupInFlight) {
    await closeCleanupInFlight;
    return;
  }

  closeCleanupInFlight = (async () => {
    logEvent('helper.close.cleanup.start', currentPairing?.context, {
      reason,
      status: normalizeSessionStatus(currentPairing?.session ?? null),
    });

    await cancelActiveSecureSessionOnClose(reason);
    await clearWhatsAppWebLocalSession(reason);
    await cleanupActiveControlledBrowser(reason);

    logEvent('helper.close.cleanup.done', currentPairing?.context, {
      reason,
    });
  })()
    .catch((error) => {
      logEvent('helper.close.cleanup.error', currentPairing?.context, {
        reason: sanitizeError(error),
      });
    })
    .finally(() => {
      closeCleanupInFlight = null;
      closeMainWindowAndQuit();
    });

  await closeCleanupInFlight;
}

async function cancelActiveSecureSessionOnClose(reason: string): Promise<void> {
  const pairing = currentPairing;

  if (!pairing || pairing.context.mode !== 'secure') {
    return;
  }

  pairing.session = await fetchPairingSession(pairing.context).catch(
    (error) => {
      logEvent('helper.close.cancel_status.fetch_error', pairing.context, {
        reason: sanitizeError(error),
      });
      return pairing.session;
    }
  );

  const status = normalizeSessionStatus(pairing.session);
  if (!status || !SECURE_SESSION_HELPER_CANCELLABLE_STATUSES.has(status)) {
    logEvent('helper.close.cancel_status.skipped', pairing.context, {
      close_reason: reason,
      status,
    });
    return;
  }

  await updateSecureStatusFromMain({
    message: 'Underchat Authenticator fechado antes da conclusão.',
    status: 'cancelled',
  }).catch((error) => {
    logEvent('helper.close.cancel_status.error', pairing.context, {
      close_reason: reason,
      reason: sanitizeError(error),
      status,
    });
  });
}

function closeMainWindowAndQuit(): void {
  allowMainWindowClose = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
}

async function clearWhatsAppWebLocalSession(reason: string): Promise<void> {
  const tokenHash = currentPairing?.context.tokenHash ?? null;
  if (tokenHash && localSessionClearedTokenHash === tokenHash) {
    return;
  }

  if (localSessionClearInFlight) {
    await localSessionClearInFlight;
    return;
  }

  localSessionClearInFlight = clearWhatsAppWebLocalSessionInternal(reason)
    .then(() => {
      localSessionClearedTokenHash = tokenHash;
    })
    .finally(() => {
      localSessionClearInFlight = null;
    });

  await localSessionClearInFlight;
}

async function clearWhatsAppWebLocalSessionInternal(
  reason: string
): Promise<void> {
  logEvent(
    'secure_session.legacy_partition.clear.start',
    currentPairing?.context,
    {
      reason,
    }
  );

  const partitionRoot = getWhatsAppWebPartitionRoot();
  await rm(partitionRoot, { recursive: true, force: true }).catch((error) => {
    logEvent(
      'secure_session.legacy_partition.clear.remove_error',
      currentPairing?.context,
      {
        reason: sanitizeError(error),
      }
    );
  });

  logEvent(
    'secure_session.legacy_partition.clear.done',
    currentPairing?.context,
    {
      partition_removed: true,
      reason,
    }
  );
}

function getWhatsAppWebPartitionRoot(): string {
  return join(app.getPath('userData'), 'Partitions', 'underchat-authenticator');
}

async function saveDiagnosticLog(): Promise<{
  message?: string;
  status: string;
}> {
  const tokenHash = currentPairing?.context.tokenHash ?? 'sem-token';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultPath = join(
    app.getPath('downloads'),
    `underchat-authenticator-${tokenHash}-${timestamp}.json`
  );

  const saveDialogOptions = {
    buttonLabel: 'Salvar log',
    defaultPath,
    filters: [
      {
        extensions: ['json'],
        name: 'JSON',
      },
    ],
    title: 'Salvar log de diagnóstico Underchat Authenticator',
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions);

  if (result.canceled || !result.filePath) {
    logEvent('diagnostic_log.download.cancelled', currentPairing?.context);
    return { status: 'cancelled' };
  }

  const snapshot = {
    app: {
      channel: authenticatorBuildChannel,
      diagnostics_enabled: diagnosticsEnabled,
      electron: process.versions.electron,
      node: process.versions.node,
      packaged: app.isPackaged,
      platform: process.platform,
      version: app.getVersion(),
    },
    context: currentPairing
      ? {
          api_base_url: redactApiBaseUrl(currentPairing.context.apiBaseUrl),
          mode: currentPairing.context.mode,
          token_hash: currentPairing.context.tokenHash,
        }
      : null,
    current_page: mainWindow
      ? {
          domain: getSafeDomain(mainWindow.webContents.getURL()),
          url: sanitizeUrlForDiagnostics(mainWindow.webContents.getURL()),
        }
      : null,
    generated_at: new Date().toISOString(),
    session: currentPairing?.session
      ? redactDiagnosticValue(currentPairing.session)
      : null,
    storage: {
      legacy_partition_root: getWhatsAppWebPartitionRoot(),
      legacy_partition_removed_for_token_hash: localSessionClearedTokenHash,
    },
    events: diagnosticLogEntries,
  };

  await writeFile(result.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  logEvent('diagnostic_log.download.saved', currentPairing?.context, {
    file_path: result.filePath,
  });

  return {
    message: result.filePath,
    status: 'saved',
  };
}

function redactApiBaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'invalid-url';
  }
}

function sanitizeUrlForDiagnostics(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'data:') {
      return 'underchat-authenticator://local-ui';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return 'invalid-url';
  }
}

function summarizeAuthDump(dump: unknown): Record<string, unknown> {
  const root =
    dump && typeof dump === 'object' && !Array.isArray(dump)
      ? (dump as Record<string, unknown>)
      : {};
  const creds =
    root.creds && typeof root.creds === 'object' && !Array.isArray(root.creds)
      ? (root.creds as Record<string, unknown>)
      : {};
  const noiseKey =
    creds.noiseKey &&
    typeof creds.noiseKey === 'object' &&
    !Array.isArray(creds.noiseKey)
      ? (creds.noiseKey as Record<string, unknown>)
      : {};
  const me =
    creds.me && typeof creds.me === 'object' && !Array.isArray(creds.me)
      ? (creds.me as Record<string, unknown>)
      : {};

  return {
    app_state_sync_key_count: root.appStateSyncKeyCount ?? null,
    app_state_version_count: root.appStateVersionCount ?? null,
    debug: root._debug ?? null,
    has_creds: Boolean(root.creds),
    has_me: typeof me.id === 'string' && me.id.length > 0,
    has_noise_key:
      typeof noiseKey.private === 'string' &&
      noiseKey.private.length > 0 &&
      typeof noiseKey.public === 'string' &&
      noiseKey.public.length > 0,
    registration_id_present: typeof creds.registrationId === 'number',
  };
}

async function collectProfileEntryFiles(input: {
  budget: { totalBytes: number };
  files: SecureSessionProfileFiles;
  outputPrefix?: string;
  profileRoot: string;
  targetPath: string;
}): Promise<void> {
  const entries = await readdir(input.targetPath, {
    withFileTypes: true,
  }).catch(() => []);

  for (const entry of entries) {
    if (WWEBJS_PROFILE_SKIP_FILE_NAMES.has(entry.name)) {
      continue;
    }

    const entryPath = join(input.targetPath, entry.name);
    if (entry.isDirectory()) {
      await collectProfileEntryFiles({
        ...input,
        targetPath: entryPath,
      });
      continue;
    }

    if (entry.isFile()) {
      await addProfileFile({
        ...input,
        targetPath: entryPath,
      });
    }
  }
}

async function addProfileFile(input: {
  budget: { totalBytes: number };
  files: SecureSessionProfileFiles;
  outputPrefix?: string;
  profileRoot: string;
  targetPath: string;
}): Promise<void> {
  const fileStat = await stat(input.targetPath).catch(() => null);
  if (!fileStat?.isFile()) {
    return;
  }

  const nextTotal = input.budget.totalBytes + fileStat.size;
  if (nextTotal > WWEBJS_PROFILE_MAX_BYTES) {
    throw new Error('wwebjs_profile_export_size_limit_exceeded');
  }

  input.budget.totalBytes = nextTotal;
  const relativePath = relative(input.profileRoot, input.targetPath)
    .split(sep)
    .join('/');
  const outputPath = `${input.outputPrefix ?? 'Default/'}${relativePath}`;
  const data = await readFile(input.targetPath);
  input.files[outputPath] = {
    data: data.toString('base64'),
    encoding: 'base64',
  };
}

async function handleDeepLink(rawUrl: string): Promise<void> {
  let context: AuthenticatorDeepLinkContext;

  try {
    context = parseAuthenticatorDeepLink(rawUrl);
  } catch (error) {
    currentPairing = {
      context: {
        apiBaseUrl: '',
        mode: 'secure',
        token: '',
        tokenHash: 'invalid-link',
      },
      error: sanitizeError(error),
      session: null,
    };
    createMainWindow();
    return;
  }

  currentPairing = {
    context,
    error: null,
    session: null,
  };

  logEvent('deeplink.received', context, {
    apiOrigin: new URL(context.apiBaseUrl).origin,
  });
  createMainWindow();

  try {
    currentPairing.session = await fetchPairingSession(context);
    mainWindow?.webContents.send('underchat-authenticator:session-updated');
  } catch (error) {
    currentPairing.error = sanitizeError(error);
    logEvent('session.fetch.error', context, { error: currentPairing.error });
    mainWindow?.webContents.send('underchat-authenticator:session-updated');
  }
}

async function fetchPairingSession(
  context: AuthenticatorDeepLinkContext
): Promise<AuthenticatorSession> {
  logEvent('session.fetch.start', context);
  const session = await apiClient.fetchSession(context);
  logEvent('session.fetch.done', context, {
    mode: context.mode,
    status: session.status ?? null,
    worker_id: session.worker_id ?? null,
    worker_type_id: session.worker_type_id ?? null,
  });
  return session;
}

function createMainWindow(initialError?: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (initialError && currentPairing) {
      currentPairing.error = initialError;
    }

    loadAuthenticatorShell(mainWindow).catch((error: unknown) => {
      console.error(
        '[underchat-authenticator] window.reload.error',
        sanitizeError(error)
      );
    });
    mainWindow.focus();
    return;
  }

  console.log('[underchat-authenticator] window.create.start');
  allowMainWindowClose = false;
  mainWindow = new BrowserWindow({
    backgroundColor: '#f4efe7',
    autoHideMenuBar: true,
    height: 560,
    minHeight: 500,
    minWidth: 380,
    show: false,
    title: 'Underchat Authenticator',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(appMainDir, '../preload/index.js'),
      sandbox: false,
    },
    width: 420,
  });
  console.log('[underchat-authenticator] window.create.done');
  mainWindow.setMenuBarVisibility(false);

  let hasShownWindow = false;
  const showMainWindow = (reason: string): void => {
    if (!mainWindow || mainWindow.isDestroyed() || hasShownWindow) {
      return;
    }

    hasShownWindow = true;
    mainWindow.show();
    mainWindow.focus();
    console.log('[underchat-authenticator] window.show', { reason });
  };

  mainWindow.once('ready-to-show', () => {
    showMainWindow('ready-to-show');
  });

  setTimeout(() => {
    showMainWindow('timeout');
  }, 3000);

  mainWindow.on('close', (event) => {
    if (allowMainWindowClose) {
      return;
    }

    event.preventDefault();
    void closeHelperAfterCleanup('window_close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    allowMainWindowClose = false;
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl) => {
      console.error('[underchat-authenticator] window.load.failed', {
        domain: getSafeDomain(validatedUrl),
        errorCode,
        errorDescription,
      });
    }
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[underchat-authenticator] renderer.gone', details);
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith('data:text/html')) {
      event.preventDefault();
      logBlockedNavigation(navigationUrl);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logBlockedNavigation(url);
    return { action: 'deny' };
  });

  if (initialError) {
    currentPairing = {
      context: {
        apiBaseUrl: '',
        mode: 'secure',
        token: '',
        tokenHash: 'invalid-link',
      },
      error: initialError,
      session: null,
    };
  }

  console.log('[underchat-authenticator] window.load.start', {
    domain: 'local-authenticator-ui',
  });
  loadAuthenticatorShell(mainWindow).catch((error: unknown) => {
    console.error(
      '[underchat-authenticator] window.load.error',
      sanitizeError(error)
    );
  });

  if (isDevelopment) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[underchat-authenticator] ui.loaded');
    });
  }
}

async function loadAuthenticatorShell(window: BrowserWindow): Promise<void> {
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(getAuthenticatorShellHtml())}`
  );
}

function getAuthenticatorShellHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; connect-src 'none';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Underchat Authenticator</title>
  </head>
  <body>
    <main id="underchat-authenticator-root"></main>
  </body>
</html>`;
}

function logBlockedNavigation(rawUrl: string): void {
  const domain = getSafeDomain(rawUrl);

  console.warn('[underchat-authenticator] navigation.blocked', { domain });
}

function getSafeDomain(rawUrl: string): string {
  let domain = 'invalid-url';

  try {
    const parsed = new URL(rawUrl);
    domain =
      parsed.protocol === 'data:' ? 'local-authenticator-ui' : parsed.hostname;
  } catch {
    // keep sanitized fallback
  }

  return domain;
}

function logEvent(
  event: string,
  context: AuthenticatorDeepLinkContext | null | undefined,
  details: Record<string, unknown> = {}
): void {
  const safeDetails = redactDiagnosticValue(details) as Record<string, unknown>;
  const output = {
    ...safeDetails,
    tokenHash: context?.tokenHash,
  };
  diagnosticLogEntries.push({
    details: safeDetails,
    event,
    timestamp: new Date().toISOString(),
    tokenHash: context?.tokenHash,
  });
  if (diagnosticLogEntries.length > MAX_DIAGNOSTIC_LOG_ENTRIES) {
    diagnosticLogEntries.splice(
      0,
      diagnosticLogEntries.length - MAX_DIAGNOSTIC_LOG_ENTRIES
    );
  }
  console.log('[underchat-authenticator]', event, output);
}

function redactDiagnosticValue(value: unknown, key = ''): unknown {
  if (isSensitiveDiagnosticKey(key)) {
    return '[redacted]';
  }

  if (Array.isArray(value)) {
    if (key && /cookies?|payload|files?/i.test(key)) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 100).map((item) => redactDiagnosticValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    output[entryKey] = redactDiagnosticValue(entryValue, entryKey);
  }
  return output;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return /(^token$|token$|secret|private|public_key|passkey|signature|cookie|payload|qrcode|qr_code|creds|auth|value|data|content|sessionPackage)/i.test(
    key
  );
}
