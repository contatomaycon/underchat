import { app, BrowserWindow, dialog, ipcMain } from 'electron';
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

import {
  AuthenticatorApiClient,
  type AuthenticatorActionResult,
  type AuthenticatorSession,
  type SecureSessionPackage,
} from './apiClient';
import {
  extractDeepLinkFromArgv,
  isAllowedHttpApiUrl,
  parseAuthenticatorDeepLink,
  AUTHENTICATOR_PROTOCOL,
  sanitizeError,
  type AuthenticatorDeepLinkContext,
} from './deepLink';

declare const __UNDERCHAT_AUTHENTICATOR_CHANNEL__: string;

const appMainDir = import.meta.dirname;
const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const WHATSAPP_WEB_STORAGE_PARTITION = 'persist:underchat-authenticator';
const WHATSAPP_WEB_STORAGE_PARTITION_DIR = 'underchat-authenticator';
const CHROME_STABLE_VERSION = '150.0.7871.46';
const CHROME_STABLE_MAJOR_VERSION =
  CHROME_STABLE_VERSION.split('.')[0] ?? '150';
const WWEBJS_PROFILE_MAX_BYTES = 80 * 1024 * 1024;
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
const CONTROLLED_BROWSER_EXIT_TIMEOUT_MS = 6_000;
const CONTROLLED_BROWSER_PROVIDER_MAP: Record<
  string,
  SecureSessionPackage['target_provider']
> = {
  '019a930d-c6f6-766d-9c84-53307d4159a1': 'baileys',
  '019a930d-c6f6-766d-9c84-62b9c3e7d1f0': 'wwebjs',
  'e80ad183-2b46-4628-9105-a036f2d28720': 'whatsmeow',
};
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
const whatsAppWebUserAgent = getWhatsAppWebUserAgent();

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
type ControlledBrowserKind = 'chrome' | 'edge';
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
type ControlledBrowserPageContext = {
  href: string;
  indexedDbNames: string[];
  userAgent: string;
  webVersion?: string;
};
type BufferJsonWrapper = {
  data: string;
  type: 'Buffer';
};
type WhatsAppWebExtractedCreds = {
  account: {
    accountSignature: string;
    accountSignatureKey: string;
    details: string;
    deviceSignature: string;
  };
  advSecretKey: string | null;
  firstUnuploadedPreKeyId: number;
  me: {
    id: string;
    lid?: string;
    name?: string | null;
    username?: string | null;
  };
  nextPreKeyId: number;
  noiseKey: {
    private: string;
    public: string;
  };
  platform: 'web';
  registrationId: number;
  signedIdentityKey: {
    private: string;
    public: string;
  };
  signedPreKey: {
    keyId: number;
    keyPair: {
      private: string;
      public: string;
    };
    signature: string;
  };
};
type WhatsAppWebAuthDump = {
  _debug?: JsonRecord[];
  appStateSyncKeyCount: number;
  appStateVersionCount: number;
  creds: WhatsAppWebExtractedCreds;
};
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
app.userAgentFallback = whatsAppWebUserAgent;
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

  ipcMain.handle('underchat-authenticator:extract-wa-auth-dump', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Janela do WhatsApp Web não está aberta.');
    }

    const currentUrl = mainWindow.webContents.getURL();
    if (!currentUrl.startsWith(WHATSAPP_WEB_ORIGIN)) {
      throw new Error('A janela atual não está no WhatsApp Web.');
    }

    logEvent(
      'secure_session.auth_dump.page_world.start',
      currentPairing?.context,
      {
        domain: getSafeDomain(currentUrl),
      }
    );

    let dump: unknown;

    try {
      dump = await withTimeout(
        mainWindow.webContents.executeJavaScript(
          EXTRACT_WHATSAPP_WEB_AUTH_DUMP_SCRIPT,
          false
        ),
        WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
        'Tempo excedido ao extrair credenciais do WhatsApp Web.'
      );
    } catch (error) {
      logEvent(
        'secure_session.auth_dump.page_world.error',
        currentPairing?.context,
        {
          reason: sanitizeError(error),
        }
      );
      throw error;
    }

    logEvent(
      'secure_session.auth_dump.page_world.done',
      currentPairing?.context,
      summarizeAuthDump(dump)
    );

    return dump;
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
            'O Chrome/Edge controlado já está aberto para esta verificação.',
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
    'underchat-authenticator:upload-secure-session',
    async (_event, sessionPackage: SecureSessionPackage) => {
      if (!currentPairing) {
        throw new Error('Sessão segura não iniciada.');
      }

      logEvent('secure_session.upload.start', currentPairing.context, {
        format_version: sessionPackage.format_version,
        has_payload: sessionPackage.payload !== undefined,
        has_payload_ref: Boolean(sessionPackage.payload_ref),
        target_provider: sessionPackage.target_provider,
      });
      const enrichedPackage = await enrichSecureSessionPackage(sessionPackage);
      logEvent('secure_session.upload.package_ready', currentPairing.context, {
        cookie_count: countElectronCookies(enrichedPackage.payload),
        has_payload: enrichedPackage.payload !== undefined,
        has_payload_ref: Boolean(enrichedPackage.payload_ref),
      });
      const result = await apiClient.uploadSecureSession(
        currentPairing.context,
        enrichedPackage
      );
      currentPairing.session = await fetchPairingSession(
        currentPairing.context
      ).catch(() => currentPairing?.session ?? null);
      const nextStatus = normalizeSessionStatus(currentPairing.session);
      if (nextStatus === 'connected_confirmed') {
        scheduleConnectedCleanupAndClose('secure_session_connected');
      }
      mainWindow?.webContents.send('underchat-authenticator:session-updated');
      logEvent('secure_session.upload.done', currentPairing.context, {
        next_status: nextStatus,
        status: result.status ?? null,
      });
      return result;
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

function countElectronCookies(payload: unknown): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 0;
  }

  const cookies = (payload as Record<string, unknown>).electron_cookies;
  return Array.isArray(cookies) ? cookies.length : 0;
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

const CONTROLLED_BROWSER_READINESS_SCRIPT = String.raw`
(() => {
  function hasWhatsAppSyncBlockingText() {
    const text = document.body && document.body.innerText ? document.body.innerText : '';
    if (!text) return false;
    return [
      /mantenha\s+o\s+app\s+aberto\s+nos\s+dois\s+dispositivos/i,
      /keep\s+(?:the\s+)?app\s+open\s+on\s+both\s+devices/i,
      /keep\s+whatsapp\s+open\s+on\s+both\s+devices/i,
      /sincronizando\s+(?:suas\s+)?mensagens/i,
      /syncing\s+(?:your\s+)?messages/i,
      /carregando\s+(?:suas\s+)?mensagens/i,
      /loading\s+(?:your\s+)?messages/i
    ].some(function(pattern) { return pattern.test(text); });
  }

  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    return {
      authenticated: false,
      hasBlockingLoginUi: false,
      hasChatUi: false,
      readyForHandoff: false,
      reason: 'not_whatsapp_web',
      syncing: false
    };
  }

  const blockingSelectors = [
    'canvas[aria-label*="Scan"]',
    '[data-testid="qrcode"]',
    '[data-ref] canvas',
    'input[name="phone"]'
  ];
  const hasBlockingLoginUi = blockingSelectors.some(function(selector) {
    return document.querySelector(selector);
  });
  const hasSyncBlockingText = hasWhatsAppSyncBlockingText();
  const selectors = [
    '#side',
    '[data-testid="chat-list"]',
    '[data-testid="conversation-list"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[aria-label="Chat list"]',
    '[aria-label="Lista de conversas"]',
    '[contenteditable="true"][role="textbox"]'
  ];
  const hasChatUi = selectors.some(function(selector) {
    return document.querySelector(selector);
  });
  const authenticated = !hasBlockingLoginUi && hasChatUi;
  const readyForHandoff = authenticated && !hasSyncBlockingText;
  const reason = hasBlockingLoginUi
    ? 'login_required'
    : hasSyncBlockingText
      ? 'whatsapp_web_syncing'
      : hasChatUi
        ? 'ready_for_handoff'
        : 'waiting_for_chat_ui';

  return {
    authenticated,
    hasBlockingLoginUi,
    hasChatUi,
    readyForHandoff,
    reason,
    syncing: authenticated && hasSyncBlockingText
  };
})()
`;

const CONTROLLED_BROWSER_PAGE_CONTEXT_SCRIPT = String.raw`
(async () => {
  const indexedDbNames =
    typeof indexedDB.databases === 'function'
      ? await indexedDB
          .databases()
          .then(function(databases) {
            return databases
              .map(function(database) { return database.name; })
              .filter(function(name) { return Boolean(name); });
          })
          .catch(function() { return []; })
      : [];
  const versionSource = [
    document.querySelector('meta[name="version"]') &&
      document.querySelector('meta[name="version"]').getAttribute('content'),
    document.documentElement.getAttribute('data-app-version')
  ].find(function(value) { return value && value.trim(); });

  return {
    href: location.href,
    indexedDbNames,
    userAgent: navigator.userAgent,
    webVersion: versionSource ? versionSource.trim() : undefined
  };
})()
`;

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
      'Abrindo Chrome/Edge controlado para concluir a passkey por smartphone ou tablet.',
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
      throw new Error('O Chrome/Edge não expôs o alvo CDP do WhatsApp Web.');
    }

    pageSession = await CdpSession.connect(target.webSocketDebuggerUrl);
    await pageSession.send('Runtime.enable').catch(() => undefined);

    await waitForControlledBrowserHandoffReady(pageSession, instance);
    const sessionPackage = await collectControlledBrowserSecureSessionPackage(
      pageSession,
      instance
    );
    let uploadPackage = sessionPackage;

    if (shouldIncludeWwebjsProfile(sessionPackage.target_provider)) {
      await closeControlledBrowserProcess(
        instance,
        'controlled_browser_profile_export'
      );
      pageSession.close();
      pageSession = null;

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
        'O caminho em UNDERCHAT_AUTHENTICATOR_BROWSER_PATH não existe. Ajuste o caminho ou instale Chrome/Edge.'
      );
    }

    const kind = inferControlledBrowserKind(overridePath);
    return {
      executablePath: overridePath,
      kind,
      name: kind === 'edge' ? 'Microsoft Edge' : 'Google Chrome',
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
    'Não encontrei Chrome nem Edge para usar passkey por smartphone/tablet. Instale Chrome/Edge ou defina UNDERCHAT_AUTHENTICATOR_BROWSER_PATH. Você ainda pode concluir por USB nesta janela.'
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
    addCandidate(
      programFiles
        ? join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
      'edge',
      'Microsoft Edge'
    );
    addCandidate(
      programFilesX86
        ? join(
            programFilesX86,
            'Microsoft',
            'Edge',
            'Application',
            'msedge.exe'
          )
        : undefined,
      'edge',
      'Microsoft Edge'
    );
    addCandidate(
      localAppData
        ? join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : undefined,
      'edge',
      'Microsoft Edge'
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
    addCandidate(
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'edge',
      'Microsoft Edge'
    );
    addCandidate(
      home
        ? join(
            home,
            'Applications',
            'Microsoft Edge.app',
            'Contents',
            'MacOS',
            'Microsoft Edge'
          )
        : undefined,
      'edge',
      'Microsoft Edge'
    );
  } else {
    [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ].forEach((executablePath) =>
      addCandidate(executablePath, 'chrome', 'Google Chrome')
    );
    [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/opt/microsoft/msedge/msedge',
    ].forEach((executablePath) =>
      addCandidate(executablePath, 'edge', 'Microsoft Edge')
    );
  }

  for (const executablePath of getPathExecutableCandidates([
    'google-chrome',
    'google-chrome-stable',
    'chrome',
    'chromium',
    'chromium-browser',
  ])) {
    addCandidate(executablePath, 'chrome', 'Google Chrome');
  }
  for (const executablePath of getPathExecutableCandidates([
    'msedge',
    'microsoft-edge',
    'microsoft-edge-stable',
  ])) {
    addCandidate(executablePath, 'edge', 'Microsoft Edge');
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

function inferControlledBrowserKind(
  executablePath: string
): ControlledBrowserKind {
  return /(?:edge|msedge)/i.test(executablePath) ? 'edge' : 'chrome';
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
        `Chrome/Edge encerrou antes de abrir o DevTools remoto (${child.exitCode ?? child.signalCode}).`
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
    'Chrome/Edge abriu, mas não expôs a porta DevTools para controle.'
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
  throw new Error('Não consegui anexar ao WhatsApp Web no Chrome/Edge.');
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
    const evaluatedReadiness =
      await evaluateCdpExpression<WhatsAppReadinessSnapshot>(
        pageSession,
        CONTROLLED_BROWSER_READINESS_SCRIPT,
        WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
        'Não foi possível verificar o estado do WhatsApp Web no Chrome/Edge.'
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
            ? 'Aguardando autenticação no Chrome/Edge controlado.'
            : nextStatus === 'wa_syncing'
              ? 'WhatsApp Web autenticado no Chrome/Edge. Aguardando sincronização.'
              : nextStatus === 'wa_ready'
                ? 'WhatsApp Web pronto no Chrome/Edge controlado.'
                : 'WhatsApp Web autenticado no Chrome/Edge controlado.',
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
      ? 'O WhatsApp Web no Chrome/Edge ainda está sincronizando. Mantenha o app aberto nos dois dispositivos e tente novamente.'
      : 'O WhatsApp Web no Chrome/Edge ainda não ficou pronto para transferir a sessão.'
  );
}

async function collectControlledBrowserSecureSessionPackage(
  pageSession: CdpSession,
  instance: ControlledBrowserInstance
): Promise<SecureSessionPackage> {
  const targetProvider = getControlledBrowserTargetProvider();
  const pageContext = normalizeControlledBrowserPageContext(
    await evaluateCdpExpression<ControlledBrowserPageContext>(
      pageSession,
      CONTROLLED_BROWSER_PAGE_CONTEXT_SCRIPT,
      WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
      'Não foi possível ler o contexto do WhatsApp Web no Chrome/Edge.'
    )
  );
  const needsWhatsAppWebCreds = targetProvider !== 'wwebjs';
  const authDump = needsWhatsAppWebCreds
    ? normalizeWhatsAppWebAuthDump(
        await evaluateCdpExpression<unknown>(
          pageSession,
          EXTRACT_WHATSAPP_WEB_AUTH_DUMP_SCRIPT,
          WHATSAPP_WEB_AUTH_DUMP_TIMEOUT_MS,
          'Tempo excedido ao extrair credenciais do WhatsApp Web no Chrome/Edge.'
        )
      )
    : null;

  if (needsWhatsAppWebCreds && !authDump) {
    throw new Error(
      'O Chrome/Edge autenticou, mas não retornou o pacote de credenciais do WhatsApp Web.'
    );
  }

  logEvent(
    'secure_session.controlled_browser.package.collect.done',
    currentPairing?.context,
    {
      auth_dump: authDump ? summarizeAuthDump(authDump) : null,
      browser_kind: instance.kind,
      indexed_db_count: pageContext.indexedDbNames.length,
      target_provider: targetProvider,
    }
  );

  const payload: JsonRecord = {
    controlled_browser: {
      kind: instance.kind,
      name: instance.name,
      version: instance.version ?? null,
    },
    href: pageContext.href,
    indexed_db_names: pageContext.indexedDbNames,
    user_agent: pageContext.userAgent,
  };

  if (authDump) {
    payload.whatsapp_web_creds = authDump.creds;
    payload.whatsapp_web_session_summary = {
      app_state_sync_key_count: authDump.appStateSyncKeyCount,
      app_state_version_count: authDump.appStateVersionCount,
      has_account: Boolean(authDump.creds.account.accountSignatureKey),
      has_lid: Boolean(authDump.creds.me.lid),
      has_me: Boolean(authDump.creds.me.id),
      has_noise_key: Boolean(authDump.creds.noiseKey.private),
      has_signed_identity_key: Boolean(
        authDump.creds.signedIdentityKey.private
      ),
      has_signed_pre_key: Boolean(authDump.creds.signedPreKey.signature),
      registration_id_present: authDump.creds.registrationId > 0,
    };
  }

  if (authDump && (targetProvider === 'baileys' || targetProvider === 'auto')) {
    payload.baileys_multi_file_auth_state = {
      files: {
        'creds.json': JSON.stringify(createBaileysCredsFile(authDump.creds)),
      },
      source: 'whatsapp_web_creds',
    };
  }

  return {
    account_hint: authDump?.creds.me.id,
    created_at: new Date().toISOString(),
    format_version: 'underchat-wa-web-session-v1',
    payload,
    source: 'whatsapp_web',
    target_provider: targetProvider,
    web_version: pageContext.webVersion,
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
  const workerTypeId = currentPairing?.session?.worker_type_id;
  if (!workerTypeId) {
    return 'auto';
  }

  return CONTROLLED_BROWSER_PROVIDER_MAP[workerTypeId] ?? 'auto';
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
        : whatsAppWebUserAgent,
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

function createBaileysCredsFile(creds: WhatsAppWebExtractedCreds): JsonRecord {
  const accountSignatureKey = base64ToBytes(creds.account.accountSignatureKey);
  const signalIdentities =
    accountSignatureKey && creds.me.lid
      ? [
          {
            identifier: {
              deviceId: 0,
              name: creds.me.lid,
            },
            identifierKey: bufferWrap(
              bytesToBase64Required(
                prefixSignalPublicKey(accountSignatureKey),
                'account signature key'
              )
            ),
          },
        ]
      : [];

  return {
    account: {
      accountSignature: bufferWrap(creds.account.accountSignature),
      accountSignatureKey: bufferWrap(creds.account.accountSignatureKey),
      details: bufferWrap(creds.account.details),
      deviceSignature: bufferWrap(creds.account.deviceSignature),
    },
    accountSettings: {
      unarchiveChats: false,
    },
    accountSyncCounter: 0,
    advSecretKey: creds.advSecretKey ?? '',
    firstUnuploadedPreKeyId: creds.firstUnuploadedPreKeyId,
    me: creds.me,
    nextPreKeyId: creds.nextPreKeyId,
    noiseKey: {
      private: bufferWrap(creds.noiseKey.private),
      public: bufferWrap(creds.noiseKey.public),
    },
    pairingEphemeralKeyPair: {
      private: bufferWrap(creds.noiseKey.private),
      public: bufferWrap(creds.noiseKey.public),
    },
    platform: creds.platform,
    processedHistoryMessages: [],
    registered: true,
    registrationId: creds.registrationId,
    signalIdentities,
    signedIdentityKey: {
      private: bufferWrap(creds.signedIdentityKey.private),
      public: bufferWrap(creds.signedIdentityKey.public),
    },
    signedPreKey: {
      keyId: creds.signedPreKey.keyId,
      keyPair: {
        private: bufferWrap(creds.signedPreKey.keyPair.private),
        public: bufferWrap(creds.signedPreKey.keyPair.public),
      },
      signature: bufferWrap(creds.signedPreKey.signature),
    },
  };
}

function base64ToBytes(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  try {
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Uint8Array.from(Buffer.from(padded, 'base64'));
  } catch {
    return null;
  }
}

function bytesToBase64Required(
  value: Uint8Array | null,
  label: string
): string {
  if (!value) {
    throw new Error(`Não foi possível converter ${label} para base64.`);
  }

  return Buffer.from(value).toString('base64');
}

function prefixSignalPublicKey(value: Uint8Array): Uint8Array {
  if (value.length === 33) {
    return value;
  }

  const output = new Uint8Array(value.length + 1);
  output[0] = 5;
  output.set(value, 1);
  return output;
}

function bufferWrap(base64: string): BufferJsonWrapper {
  return {
    data: base64,
    type: 'Buffer',
  };
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
  const browserSession = await CdpSession.connect(browserCdpUrl).catch(
    () => null
  );
  if (browserSession) {
    await browserSession.send('Browser.close').catch(() => undefined);
    browserSession.close();
  }

  const exited = await waitForChildExit(
    instance.child,
    CONTROLLED_BROWSER_EXIT_TIMEOUT_MS
  );
  if (!exited) {
    instance.child.kill();
    await waitForChildExit(instance.child, 2_000);
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

function describeCdpException(exceptionDetails: unknown): string {
  if (!isRecord(exceptionDetails)) {
    return 'O Chrome/Edge retornou erro ao executar CDP.';
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
  return description ?? 'O Chrome/Edge retornou erro ao executar CDP.';
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
          new Error('Não consegui conectar ao CDP do Chrome/Edge.')
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  logEvent(
    'secure_session.local_session.clear.start',
    currentPairing?.context,
    {
      reason,
      partition: WHATSAPP_WEB_STORAGE_PARTITION,
    }
  );

  try {
    mainWindow.webContents.stop();
    if (!mainWindow.webContents.getURL().startsWith('about:blank')) {
      await mainWindow.webContents.loadURL('about:blank');
    }
  } catch (error) {
    logEvent(
      'secure_session.local_session.clear.navigate_error',
      currentPairing?.context,
      {
        reason: sanitizeError(error),
      }
    );
  }

  const webSession = mainWindow.webContents.session;
  const clearResults = await Promise.allSettled([
    webSession.clearStorageData({
      origin: WHATSAPP_WEB_ORIGIN,
      storages: [
        'cachestorage',
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'serviceworkers',
        'shadercache',
      ],
    }),
    webSession.clearCache(),
    webSession.cookies
      .get({ url: WHATSAPP_WEB_ORIGIN })
      .then((cookies) =>
        Promise.all(
          cookies.map((cookie) =>
            webSession.cookies.remove(
              `${WHATSAPP_WEB_ORIGIN}${cookie.path || '/'}`,
              cookie.name
            )
          )
        )
      ),
  ]);

  await Promise.resolve(webSession.flushStorageData()).catch(() => undefined);

  const partitionRoot = getWhatsAppWebPartitionRoot();
  await rm(partitionRoot, { recursive: true, force: true }).catch((error) => {
    logEvent(
      'secure_session.local_session.clear.profile_remove_error',
      currentPairing?.context,
      {
        reason: sanitizeError(error),
      }
    );
  });

  logEvent('secure_session.local_session.clear.done', currentPairing?.context, {
    failed_steps: clearResults.filter((result) => result.status === 'rejected')
      .length,
    partition_removed: true,
    reason,
  });
}

function getWhatsAppWebPartitionRoot(): string {
  return join(
    app.getPath('userData'),
    'Partitions',
    WHATSAPP_WEB_STORAGE_PARTITION_DIR
  );
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
      partition: WHATSAPP_WEB_STORAGE_PARTITION,
      partition_root: getWhatsAppWebPartitionRoot(),
      local_session_cleared_for_token_hash: localSessionClearedTokenHash,
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

const EXTRACT_WHATSAPP_WEB_AUTH_DUMP_SCRIPT = String.raw`
(async () => {
  const extractionDebug = [];

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function pushDebug(event, details) {
    extractionDebug.push({
      details: details || {},
      event
    });
  }

  function summarizeRecordKeys(value) {
    return isRecord(value) ? Object.keys(value).slice(0, 40).sort() : [];
  }

  function summarizePair(pair) {
    return pair
      ? {
          priv_len: pair.private ? pair.private.length : 0,
          pub_len: pair.public ? pair.public.length : 0,
          plausible: isPlausibleNoiseKeyPair(pair.private, pair.public)
        }
      : null;
  }

  function bytesToBase64(value) {
    const bytes = toUint8(value);
    if (!bytes) return null;
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + step)));
    }
    return btoa(binary);
  }

  function bytesToBase64Required(value, label) {
    const base64 = bytesToBase64(value);
    if (!base64) throw new Error('Não foi possível converter ' + label + ' para base64.');
    return base64;
  }

  function toUint8(value) {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === 'string') {
      const base64Bytes = base64ToBytes(value);
      if (base64Bytes) return base64Bytes;
      return Uint8Array.from(value, function(char) { return char.charCodeAt(0); });
    }
    if (isRecord(value) && value.type === 'Buffer' && typeof value.data === 'string') {
      try {
        return Uint8Array.from(atob(value.data), function(char) { return char.charCodeAt(0); });
      } catch {
        return null;
      }
    }
    return null;
  }

  function base64ToBytes(value) {
    const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    try {
      return Uint8Array.from(atob(padded), function(char) { return char.charCodeAt(0); });
    } catch {
      return null;
    }
  }

  function getPath(value, path) {
    let current = value;
    for (const key of path) {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
    return current;
  }

  function toUint8FromPaths(value, paths) {
    for (const path of paths) {
      const bytes = toUint8(getPath(value, path));
      if (bytes) return bytes;
    }
    return null;
  }

  function toPositiveInteger(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

  function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function openIndexedDb(name) {
    return new Promise(function(resolve, reject) {
      const request = indexedDB.open(name);
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error || new Error('indexeddb_open_failed:' + name)); };
    });
  }

  function getAllFromIndexedDbStore(database, storeName) {
    return new Promise(function(resolve, reject) {
      try {
        if (!database.objectStoreNames.contains(storeName)) {
          resolve([]);
          return;
        }
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = function() { resolve(Array.isArray(request.result) ? request.result : []); };
        request.onerror = function() { reject(request.error || new Error('indexeddb_get_all_failed:' + storeName)); };
      } catch (error) {
        reject(error);
      }
    });
  }

  async function getAllFromFirstStore(database, storeNames) {
    for (const storeName of storeNames) {
      const rows = await getAllFromIndexedDbStore(database, storeName);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  function createSignalMetaMap(rows) {
    const metaMap = {};
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const key = normalizeOptionalString(row.key);
      if (!key) continue;
      metaMap[key] = row.value;
    }
    return metaMap;
  }

  async function decryptRegistrationMaterial(value) {
    if (!isRecord(value)) return null;
    const encrypted = toUint8(value.value);
    if (!value.encKey || !encrypted) return null;
    const decrypted = await crypto.subtle.decrypt(
      { counter: new Uint8Array(16), length: 128, name: 'AES-CTR' },
      value.encKey,
      new Uint8Array(encrypted)
    );
    return new Uint8Array(decrypted);
  }

  function unwrapModule(moduleValue) {
    return moduleValue && moduleValue.default ? moduleValue.default : moduleValue;
  }

  function getWaModule(name) {
    try {
      if (typeof window.require === 'function') {
        return unwrapModule(window.require(name));
      }
    } catch {}

    try {
      if (typeof require === 'function') {
        return unwrapModule(require(name));
      }
    } catch {}

    try {
      if (typeof window.__d === 'function') {
        let captured;
        const sentinel = '__underchatWaProbe_' + Math.random().toString(36).slice(2);
        window.__d(sentinel, [name], function(_target, _exports, _module, parentRequire) {
          if (typeof parentRequire === 'function') captured = unwrapModule(parentRequire(name));
        });
        if (!captured && typeof window.__d.require === 'function') {
          captured = unwrapModule(window.__d.require(name));
        }
        if (captured) return captured;
      }
    } catch {}

    return null;
  }

  async function getRegistrationInfoViaInternalModule() {
    const moduleValue = getWaModule('WAWebSignalStoreApi');
    const signalStore = isRecord(moduleValue) ? moduleValue.waSignalStore : null;
    const getter = isRecord(signalStore) ? signalStore.getRegistrationInfo : null;
    if (typeof getter !== 'function') return null;
    try {
      return await getter();
    } catch {
      return null;
    }
  }

  async function getNoiseInfoViaInternalModule() {
    const moduleValue = getWaModule('WAWebUserPrefsInfoStore');
    pushDebug('noise.module.lookup', {
      module_present: isRecord(moduleValue),
      module_keys: summarizeRecordKeys(moduleValue)
    });

    const containers = [];
    if (isRecord(moduleValue)) {
      containers.push({ label: 'module', value: moduleValue });
      if (isRecord(moduleValue.waNoiseInfo)) {
        containers.push({ label: 'module.waNoiseInfo', value: moduleValue.waNoiseInfo });
      }
      if (isRecord(moduleValue.default)) {
        containers.push({ label: 'module.default', value: moduleValue.default });
      }
      if (isRecord(moduleValue.default) && isRecord(moduleValue.default.waNoiseInfo)) {
        containers.push({ label: 'module.default.waNoiseInfo', value: moduleValue.default.waNoiseInfo });
      }
    }

    for (const candidate of containers) {
      const container = candidate.value;
      pushDebug('noise.container.inspect', {
        label: candidate.label,
        keys: summarizeRecordKeys(container)
      });
      const directPair = normalizeNoiseKeyPair(container);
      if (directPair) {
        pushDebug('noise.source.selected', {
          source: candidate.label,
          pair: summarizePair(directPair)
        });
        return directPair;
      }

      for (const field of ['noiseInfo', 'staticKeyPair', 'keyPair', 'value']) {
        const fieldPair = normalizeNoiseKeyPair(container[field]);
        if (fieldPair) {
          pushDebug('noise.source.selected', {
            source: candidate.label + '.' + field,
            pair: summarizePair(fieldPair)
          });
          return fieldPair;
        }
      }

      for (const methodName of ['getUnlockedNoiseInfo', 'getNoiseInfo', 'get', 'getNoiseInfoStore']) {
        const getter = container[methodName];
        if (typeof getter !== 'function') {
          pushDebug('noise.method.missing', {
            container: candidate.label,
            method: methodName
          });
          continue;
        }
        try {
          const value = await getter.call(container);
          const pair = normalizeNoiseKeyPair(value);
          pushDebug('noise.method.result', {
            container: candidate.label,
            method: methodName,
            pair: summarizePair(pair),
            value_keys: summarizeRecordKeys(value)
          });
          if (pair) return pair;
        } catch (error) {
          pushDebug('noise.method.error', {
            container: candidate.label,
            method: methodName,
            reason: error && error.message ? String(error.message) : String(error)
          });
        }
      }
    }

    return getNoiseInfoFromLocalStorage();
  }

  function normalizeNoiseKeyPair(value) {
    if (!isRecord(value)) return null;

    const candidates = [
      value,
      value.staticKeyPair,
      value.keyPair,
      value.noiseKey,
      value.noiseInfo,
      value.value,
      value.data
    ];

    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      const publicKey = toUint8FromPaths(candidate, [
        ['pubKey'],
        ['publicKey'],
        ['public'],
        ['pub']
      ]);
      const privateKey = toUint8FromPaths(candidate, [
        ['privKey'],
        ['privateKey'],
        ['private'],
        ['priv']
      ]);
      if (publicKey && privateKey) {
        pushDebug('noise.pair.candidate', {
          pair: summarizePair({ private: privateKey, public: publicKey })
        });
        if (!isPlausibleNoiseKeyPair(privateKey, publicKey)) {
          continue;
        }
        return { private: privateKey, public: publicKey };
      }
    }

    return null;
  }

  function isPlausibleNoiseKeyPair(privateKey, publicKey) {
    return privateKey.length === 32 && (publicKey.length === 32 || publicKey.length === 33);
  }

  function getNoiseInfoFromLocalStorage() {
    for (const key of ['WANoiseInfo', 'NOISE_INFO', 'MD_NOISE_KEYS']) {
      const value = readLocalStorageJson(key);
      pushDebug('noise.local_storage.inspect', {
        key,
        keys: summarizeRecordKeys(value),
        present: value !== null,
        type: Array.isArray(value) ? 'array' : typeof value
      });
      const pair = normalizeNoiseKeyPair(value);
      if (pair) {
        pushDebug('noise.source.selected', {
          source: 'localStorage.' + key,
          pair: summarizePair(pair)
        });
        return pair;
      }
    }

    return null;
  }

  async function getAdvSecretKeyBase64() {
    const moduleValue = getWaModule('WAWebUserPrefsMultiDevice');
    const getter = isRecord(moduleValue) ? moduleValue.getADVSecretKey : null;
    if (typeof getter !== 'function') return null;
    try {
      const value = await getter();
      if (typeof value === 'string') return value;
      return bytesToBase64(value);
    } catch {
      return null;
    }
  }

  async function getModelTableRows(moduleName, tableGetterName) {
    const moduleValue = getWaModule(moduleName);
    const getter = isRecord(moduleValue) ? moduleValue[tableGetterName] : null;
    if (typeof getter !== 'function') return [];
    try {
      const table = getter();
      const all = isRecord(table) ? table.all : null;
      if (typeof all !== 'function') return [];
      const rows = await all();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function getLatestSignedPreKey(rows) {
    const candidates = [];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const keyPair = isRecord(row.keyPair) ? row.keyPair : null;
      const keyId = toPositiveInteger(row.keyId);
      const publicKey = keyPair ? toUint8FromPaths(keyPair, [['pubKey'], ['publicKey'], ['public']]) : null;
      const privateKey = keyPair ? toUint8FromPaths(keyPair, [['privKey'], ['privateKey'], ['private']]) : null;
      const signature = toUint8(row.signature);
      if (!keyId || !publicKey || !privateKey || !signature) continue;
      candidates.push({
        keyId,
        keyPair: {
          private: bytesToBase64Required(privateKey, 'signed pre-key private'),
          public: bytesToBase64Required(publicKey, 'signed pre-key public')
        },
        signature: bytesToBase64Required(signature, 'signed pre-key signature')
      });
    }
    candidates.sort(function(left, right) { return left.keyId - right.keyId; });
    return candidates[candidates.length - 1] || null;
  }

  function extractAdvAccount(value) {
    if (!isRecord(value)) return null;
    const accountSignature = bytesToBase64(value.accountSignature);
    const accountSignatureKey = bytesToBase64(value.accountSignatureKey);
    const details = bytesToBase64(value.details);
    const deviceSignature = bytesToBase64(value.deviceSignature);
    if (!accountSignature || !accountSignatureKey || !details || !deviceSignature) return null;
    return { accountSignature, accountSignatureKey, details, deviceSignature };
  }

  function readLocalStorageJson(key) {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function widValueToString(value) {
    if (typeof value === 'string') return value;
    if (!isRecord(value)) return null;
    return (
      normalizeOptionalString(value._serialized) ||
      normalizeOptionalString(value.serialized) ||
      normalizeOptionalString(value.id) ||
      normalizeOptionalString(value.user)
    );
  }

  function widToJid(value) {
    const wid = widValueToString(value);
    if (!wid) return null;
    const atIndex = wid.lastIndexOf('@');
    const head = atIndex >= 0 ? wid.slice(0, atIndex) : wid;
    const server = atIndex >= 0 ? wid.slice(atIndex + 1) : 's.whatsapp.net';
    const colonIndex = head.indexOf(':');
    const userAndAgent = colonIndex >= 0 ? head.slice(0, colonIndex) : head;
    const device = colonIndex >= 0 ? Number(head.slice(colonIndex + 1)) : 0;
    const dotIndex = userAndAgent.indexOf('.');
    const user = dotIndex >= 0 ? userAndAgent.slice(0, dotIndex) : userAndAgent;
    if (!user || !Number.isFinite(device)) return null;
    return user + ':' + device + '@' + server;
  }

  function readMeFromModules() {
    const connModel = getWaModule('WAWebConnModel');
    const conn = isRecord(connModel) ? connModel.Conn : null;
    if (!isRecord(conn)) return { id: null, lid: null };
    return {
      id: widToJid(conn.wid || conn.me || conn.meUser),
      lid: widToJid(conn.lid || conn.meLid || conn.lidWid)
    };
  }

  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    throw new Error('A janela atual não está no WhatsApp Web.');
  }

  const signalDb = await openIndexedDb('signal-storage');
  let metaRows = [];
  let signedPreKeyRows = [];
  try {
    metaRows = await getAllFromFirstStore(signalDb, ['signal-meta-store']);
    signedPreKeyRows = await getAllFromFirstStore(signalDb, ['signed-prekey-store', 'signed-pre-key-store']);
  } finally {
    signalDb.close();
  }

  const metaMap = createSignalMetaMap(metaRows);
  const registrationInfo = await getRegistrationInfoViaInternalModule();
  const staticPublicKey =
    (await decryptRegistrationMaterial(metaMap.signal_static_pubkey)) ||
    toUint8FromPaths(registrationInfo, [
      ['identityKeyPair', 'pubKey'],
      ['identityKeyPair', 'publicKey'],
      ['identityKeyPair', 'public']
    ]);
  const staticPrivateKey =
    (await decryptRegistrationMaterial(metaMap.signal_static_privkey)) ||
    toUint8FromPaths(registrationInfo, [
      ['identityKeyPair', 'privKey'],
      ['identityKeyPair', 'privateKey'],
      ['identityKeyPair', 'private']
    ]);
  const noise = await getNoiseInfoViaInternalModule();
  const signedPreKey = getLatestSignedPreKey(signedPreKeyRows);
  const account = extractAdvAccount(metaMap.adv_signed_identity);
  const registrationId =
    toPositiveInteger(metaMap.signal_reg_id) ||
    toPositiveInteger(getPath(registrationInfo, ['registrationId'])) ||
    toPositiveInteger(getPath(registrationInfo, ['regId']));
  const moduleMe = readMeFromModules();
  const meId = widToJid(readLocalStorageJson('last-wid-md')) || moduleMe.id;
  const meLid = widToJid(readLocalStorageJson('WALid')) || moduleMe.lid;
  const meDisplayName = normalizeOptionalString(readLocalStorageJson('me-display-name'));

  if (!registrationId) throw new Error('Não foi possível extrair o registrationId da sessão.');
  if (!noise) throw new Error('Não foi possível extrair a noise key da sessão.');
  if (!staticPublicKey || !staticPrivateKey) throw new Error('Não foi possível extrair a identity key da sessão.');
  if (!signedPreKey) throw new Error('Não foi possível extrair a signed pre-key da sessão.');
  if (!account) throw new Error('Não foi possível extrair a identidade ADV da sessão.');
  if (!meId) throw new Error('Não foi possível identificar o JID conectado.');

  const syncKeyRows = await getModelTableRows('WAWebSchemaSyncKeys', 'getSyncKeysTable');
  const versionRows = await getModelTableRows('WAWebSchemaCollectionVersion', 'getCollectionVersionTable');
  const preKeyId =
    toPositiveInteger(metaMap.signal_prekey_id) ||
    toPositiveInteger(metaMap.signal_pre_key_id) ||
    signedPreKey.keyId + 1;

  return {
    _debug: extractionDebug,
    appStateSyncKeyCount: syncKeyRows.length,
    appStateVersionCount: versionRows.length,
    creds: {
      account,
      advSecretKey: await getAdvSecretKeyBase64(),
      firstUnuploadedPreKeyId: preKeyId,
      me: Object.assign(
        { id: meId },
        meLid ? { lid: meLid } : {},
        meDisplayName ? { name: meDisplayName } : {}
      ),
      nextPreKeyId: preKeyId,
      noiseKey: {
        private: bytesToBase64Required(noise.private, 'noise private key'),
        public: bytesToBase64Required(noise.public, 'noise public key')
      },
      platform: 'web',
      registrationId,
      signedIdentityKey: {
        private: bytesToBase64Required(staticPrivateKey, 'identity private key'),
        public: bytesToBase64Required(staticPublicKey, 'identity public key')
      },
      signedPreKey
    }
  };
})()
`;

async function enrichSecureSessionPackage(
  sessionPackage: SecureSessionPackage
): Promise<SecureSessionPackage> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return sessionPackage;
  }

  const cookies = await mainWindow.webContents.session.cookies
    .get({ url: WHATSAPP_WEB_ORIGIN })
    .catch(() => []);
  const wwebjsLocalAuthFiles = await collectWwebjsLocalAuthProfileFiles(
    sessionPackage
  ).catch((error) => {
    logEvent('secure_session.profile_export.error', currentPairing?.context, {
      reason: sanitizeError(error),
      target_provider: sessionPackage.target_provider,
    });
    return null;
  });
  const payload =
    sessionPackage.payload &&
    typeof sessionPackage.payload === 'object' &&
    !Array.isArray(sessionPackage.payload)
      ? (sessionPackage.payload as Record<string, unknown>)
      : {};

  return {
    ...sessionPackage,
    payload: {
      ...payload,
      electron_cookies: cookies.map((cookie) => ({
        domain: cookie.domain,
        expirationDate: cookie.expirationDate,
        httpOnly: cookie.httpOnly,
        name: cookie.name,
        path: cookie.path,
        sameSite: cookie.sameSite,
        secure: cookie.secure,
        session: cookie.session,
        value: cookie.value,
      })),
      electron_partition: WHATSAPP_WEB_STORAGE_PARTITION,
      ...(wwebjsLocalAuthFiles
        ? {
            wwebjs_local_auth: {
              files: wwebjsLocalAuthFiles,
            },
          }
        : {}),
    },
  };
}

async function collectWwebjsLocalAuthProfileFiles(
  sessionPackage: SecureSessionPackage
): Promise<SecureSessionProfileFiles | null> {
  if (
    sessionPackage.target_provider !== 'wwebjs' &&
    sessionPackage.target_provider !== 'auto'
  ) {
    return null;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  try {
    await Promise.resolve(mainWindow.webContents.session.flushStorageData());
  } catch {}

  const partitionRoot = join(
    app.getPath('userData'),
    'Partitions',
    WHATSAPP_WEB_STORAGE_PARTITION_DIR
  );
  const files: SecureSessionProfileFiles = {};
  const budget = { totalBytes: 0 };

  for (const entryName of WWEBJS_PROFILE_INCLUDE_ROOT_ENTRIES) {
    const entryPath = join(partitionRoot, entryName);
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat) {
      continue;
    }

    if (entryStat.isDirectory()) {
      await collectProfileEntryFiles({
        budget,
        files,
        profileRoot: partitionRoot,
        targetPath: entryPath,
      });
      continue;
    }

    if (entryStat.isFile()) {
      await addProfileFile({
        budget,
        files,
        profileRoot: partitionRoot,
        targetPath: entryPath,
      });
    }
  }

  const localStatePath = join(app.getPath('userData'), 'Local State');
  if (await stat(localStatePath).catch(() => null)) {
    await addProfileFile({
      budget,
      files,
      profileRoot: app.getPath('userData'),
      targetPath: localStatePath,
      outputPrefix: '',
    });
  }

  logEvent('secure_session.profile_export.done', currentPairing?.context, {
    file_count: Object.keys(files).length,
    total_bytes: budget.totalBytes,
    target_provider: sessionPackage.target_provider,
  });

  return Object.keys(files).length ? files : null;
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

    mainWindow.loadURL(WHATSAPP_WEB_ORIGIN).catch((error: unknown) => {
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
    backgroundColor: '#0f1519',
    autoHideMenuBar: true,
    height: 720,
    minHeight: 560,
    minWidth: 760,
    show: false,
    title: 'Underchat Authenticator',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: WHATSAPP_WEB_STORAGE_PARTITION,
      preload: join(appMainDir, '../preload/index.js'),
      sandbox: false,
    },
    width: 980,
  });
  console.log('[underchat-authenticator] window.create.done');
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setUserAgent(whatsAppWebUserAgent);
  configureWhatsAppRequestHeaders(mainWindow);

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
    if (!isAllowedNavigation(navigationUrl)) {
      event.preventDefault();
      logBlockedNavigation(navigationUrl);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logBlockedNavigation(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || '';
      const allowed =
        requestingUrl.startsWith(WHATSAPP_WEB_ORIGIN) &&
        permission === 'clipboard-read';

      callback(allowed);
    }
  );

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
    domain: getSafeDomain(WHATSAPP_WEB_ORIGIN),
  });
  mainWindow
    .loadURL(WHATSAPP_WEB_ORIGIN, {
      userAgent: whatsAppWebUserAgent,
    })
    .catch((error: unknown) => {
      console.error(
        '[underchat-authenticator] window.load.error',
        sanitizeError(error)
      );
    });

  if (isDevelopment) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[underchat-authenticator] whatsapp.loaded');
    });
  }
}

function configureWhatsAppRequestHeaders(window: BrowserWindow): void {
  const platform = getUserAgentPlatform();
  const clientHintsPlatform =
    process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'darwin'
        ? 'macOS'
        : 'Linux';

  window.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [`${WHATSAPP_WEB_ORIGIN}/*`],
    },
    (details, callback) => {
      details.requestHeaders['User-Agent'] = whatsAppWebUserAgent;
      details.requestHeaders['sec-ch-ua'] =
        `"Google Chrome";v="${CHROME_STABLE_MAJOR_VERSION}", "Chromium";v="${CHROME_STABLE_MAJOR_VERSION}", "Not_A Brand";v="99"`;
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = `"${clientHintsPlatform}"`;

      callback({
        requestHeaders: details.requestHeaders,
      });
    }
  );

  console.log('[underchat-authenticator] whatsapp.headers.override', {
    chromeVersion: CHROME_STABLE_VERSION,
    platform,
  });
}

function getWhatsAppWebUserAgent(): string {
  return `Mozilla/5.0 (${getUserAgentPlatform()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_STABLE_VERSION} Safari/537.36`;
}

function getUserAgentPlatform(): string {
  if (process.platform === 'win32') {
    return 'Windows NT 10.0; Win64; x64';
  }

  if (process.platform === 'darwin') {
    return 'Macintosh; Intel Mac OS X 10_15_7';
  }

  return 'X11; Linux x86_64';
}

function isAllowedNavigation(rawUrl: string): boolean {
  if (rawUrl.startsWith(WHATSAPP_WEB_ORIGIN)) {
    return true;
  }

  if (
    currentPairing?.context.apiBaseUrl &&
    isAllowedHttpApiUrl(rawUrl, currentPairing.context.apiBaseUrl)
  ) {
    return true;
  }

  return rawUrl === 'about:blank';
}

function logBlockedNavigation(rawUrl: string): void {
  const domain = getSafeDomain(rawUrl);

  console.warn('[underchat-authenticator] navigation.blocked', { domain });
}

function getSafeDomain(rawUrl: string): string {
  let domain = 'invalid-url';

  try {
    domain = new URL(rawUrl).hostname;
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
