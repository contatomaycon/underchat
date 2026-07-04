import { app, BrowserWindow, ipcMain } from 'electron';
import { join, resolve } from 'node:path';

import {
  PasskeyHelperApiClient,
  type PasskeyHelperSession,
  type SecureSessionPackage,
} from './apiClient';
import {
  extractDeepLinkFromArgv,
  isAllowedHttpApiUrl,
  parsePasskeyDeepLink,
  PASSKEY_PROTOCOL,
  sanitizeError,
  type PasskeyDeepLinkContext,
} from './deepLink';

const appMainDir = import.meta.dirname;
const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const CHROME_STABLE_VERSION = '150.0.7871.46';
const CHROME_STABLE_MAJOR_VERSION =
  CHROME_STABLE_VERSION.split('.')[0] ?? '150';
const isDevelopment = !app.isPackaged;
const whatsAppWebUserAgent = getWhatsAppWebUserAgent();

interface CurrentPairing {
  context: PasskeyDeepLinkContext;
  error: string | null;
  session: PasskeyHelperSession | null;
}

let mainWindow: BrowserWindow | null = null;
let currentPairing: CurrentPairing | null = null;

const apiClient = new PasskeyHelperApiClient();

app.setName('Underchat Passkey Helper');
app.userAgentFallback = whatsAppWebUserAgent;
app.setPath(
  'userData',
  process.platform === 'linux'
    ? join(app.getPath('appData'), 'underchat-passkey-helper')
    : join(app.getPath('appData'), 'Underchat Passkey Helper')
);
configureRuntimeSwitches();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  console.log('[underchat-passkey-helper] single_instance.lock_denied', {
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
    console.log('[underchat-passkey-helper] protocol.register.skipped_linux', {
      protocol: PASSKEY_PROTOCOL,
    });
    return;
  }

  if (process.defaultApp && process.argv.length >= 2) {
    const entrypoint = getDefaultAppProtocolEntrypoint();

    if (entrypoint) {
      app.setAsDefaultProtocolClient(PASSKEY_PROTOCOL, process.execPath, [
        resolve(entrypoint),
      ]);
      console.log('[underchat-passkey-helper] protocol.register.default_app', {
        protocol: PASSKEY_PROTOCOL,
      });
    }

    return;
  }

  app.setAsDefaultProtocolClient(PASSKEY_PROTOCOL);
  console.log('[underchat-passkey-helper] protocol.register.packaged', {
    protocol: PASSKEY_PROTOCOL,
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
  console.log('[underchat-passkey-helper] runtime.switches.linux', {
    disableGpu: true,
    disableVulkan: true,
    ozonePlatform: 'x11',
  });
}

function getDefaultAppProtocolEntrypoint(): string | null {
  for (const arg of process.argv.slice(1)) {
    if (
      arg.startsWith('-') ||
      arg.startsWith(`${PASSKEY_PROTOCOL}://`) ||
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

    console.log('[underchat-passkey-helper] second_instance.received', {
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

    console.log('[underchat-passkey-helper] app.ready', {
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

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('underchat-passkey:get-session', async () => {
    if (!currentPairing) {
      return {
        error:
          'Abra o helper pelo link da Underchat para iniciar a verificacao.',
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

    if (!currentPairing.session) {
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
    'underchat-passkey:send-response',
    async (_event, passkeyResponse: unknown) => {
      if (!currentPairing) {
        throw new Error('Sessao de passkey nao iniciada.');
      }

      logEvent('passkey_response.send.start', currentPairing.context);
      const result = await apiClient.sendPasskeyResponse(
        currentPairing.context,
        passkeyResponse
      );
      logEvent('passkey_response.send.done', currentPairing.context, {
        status: result.status ?? result.code ?? null,
      });
      return result;
    }
  );

  ipcMain.handle('underchat-passkey:confirm', async () => {
    if (!currentPairing) {
      throw new Error('Sessao de passkey nao iniciada.');
    }

    logEvent('passkey_confirmation.send.start', currentPairing.context);
    const result = await apiClient.confirmPasskey(currentPairing.context);
    logEvent('passkey_confirmation.send.done', currentPairing.context, {
      status: result.status ?? result.code ?? null,
    });
    return result;
  });

  ipcMain.handle(
    'underchat-passkey:update-secure-status',
    async (
      _event,
      statusPayload: {
        error?: string;
        message?: string;
        status: string;
      }
    ) => {
      if (!currentPairing) {
        throw new Error('Sessao segura nao iniciada.');
      }

      const previousStatus = normalizeSessionStatus(currentPairing.session);
      logEvent('secure_session.status.update.start', currentPairing.context, {
        previous_status: previousStatus,
        requested_status: statusPayload.status,
      });
      const result = await apiClient.updateSecureStatus(
        currentPairing.context,
        {
          ...statusPayload,
          helper_platform: process.platform,
          helper_version: app.getVersion(),
        }
      );
      currentPairing.session = await fetchPairingSession(
        currentPairing.context
      ).catch(() => currentPairing?.session ?? null);
      const nextStatus =
        normalizeSessionStatus(currentPairing.session) ??
        normalizeActionStatus(result.status ?? result.code);

      if (nextStatus !== previousStatus) {
        mainWindow?.webContents.send('underchat-passkey:session-updated');
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
  );

  ipcMain.handle(
    'underchat-passkey:upload-secure-session',
    async (_event, sessionPackage: SecureSessionPackage) => {
      if (!currentPairing) {
        throw new Error('Sessao segura nao iniciada.');
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
      mainWindow?.webContents.send('underchat-passkey:session-updated');
      logEvent('secure_session.upload.done', currentPairing.context, {
        next_status: normalizeSessionStatus(currentPairing.session),
        status: result.status ?? result.code ?? null,
      });
      return result;
    }
  );
}

function normalizeSessionStatus(
  session: PasskeyHelperSession | null
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

function countElectronCookies(payload: unknown): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 0;
  }

  const cookies = (payload as Record<string, unknown>).electron_cookies;
  return Array.isArray(cookies) ? cookies.length : 0;
}

async function enrichSecureSessionPackage(
  sessionPackage: SecureSessionPackage
): Promise<SecureSessionPackage> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return sessionPackage;
  }

  const cookies = await mainWindow.webContents.session.cookies
    .get({ url: WHATSAPP_WEB_ORIGIN })
    .catch(() => []);
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
      electron_partition: 'persist:underchat-passkey-helper',
    },
  };
}

async function handleDeepLink(rawUrl: string): Promise<void> {
  let context: PasskeyDeepLinkContext;

  try {
    context = parsePasskeyDeepLink(rawUrl);
  } catch (error) {
    currentPairing = {
      context: {
        apiBaseUrl: '',
        mode: 'pair',
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
    mainWindow?.webContents.send('underchat-passkey:session-updated');
  } catch (error) {
    currentPairing.error = sanitizeError(error);
    logEvent('session.fetch.error', context, { error: currentPairing.error });
    mainWindow?.webContents.send('underchat-passkey:session-updated');
  }
}

async function fetchPairingSession(
  context: PasskeyDeepLinkContext
): Promise<PasskeyHelperSession> {
  logEvent('session.fetch.start', context);
  const session = await apiClient.fetchSession(context);
  const publicKey =
    session.publicKey ?? session.passkeyPublicKey ?? session.passkey_public_key;
  logEvent('session.fetch.done', context, {
    hasConfirmationCode: Boolean(
      session.confirmationCode ?? session.passkey_confirmation_code
    ),
    hasPublicKey: context.mode === 'secure' ? undefined : Boolean(publicKey),
    mode: context.mode,
    status: session.status ?? null,
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
        '[underchat-passkey-helper] window.reload.error',
        sanitizeError(error)
      );
    });
    mainWindow.focus();
    return;
  }

  console.log('[underchat-passkey-helper] window.create.start');
  mainWindow = new BrowserWindow({
    backgroundColor: '#0f1519',
    autoHideMenuBar: true,
    height: 720,
    minHeight: 560,
    minWidth: 760,
    show: false,
    title: 'Underchat Passkey Helper',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:underchat-passkey-helper',
      preload: join(appMainDir, '../preload/index.js'),
      sandbox: false,
    },
    width: 980,
  });
  console.log('[underchat-passkey-helper] window.create.done');
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
    console.log('[underchat-passkey-helper] window.show', { reason });
  };

  mainWindow.once('ready-to-show', () => {
    showMainWindow('ready-to-show');
  });

  setTimeout(() => {
    showMainWindow('timeout');
  }, 3000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl) => {
      console.error('[underchat-passkey-helper] window.load.failed', {
        domain: getSafeDomain(validatedUrl),
        errorCode,
        errorDescription,
      });
    }
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[underchat-passkey-helper] renderer.gone', details);
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
        mode: 'pair',
        token: '',
        tokenHash: 'invalid-link',
      },
      error: initialError,
      session: null,
    };
  }

  console.log('[underchat-passkey-helper] window.load.start', {
    domain: getSafeDomain(WHATSAPP_WEB_ORIGIN),
  });
  mainWindow
    .loadURL(WHATSAPP_WEB_ORIGIN, {
      userAgent: whatsAppWebUserAgent,
    })
    .catch((error: unknown) => {
      console.error(
        '[underchat-passkey-helper] window.load.error',
        sanitizeError(error)
      );
    });

  if (isDevelopment) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[underchat-passkey-helper] whatsapp.loaded');
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

  console.log('[underchat-passkey-helper] whatsapp.headers.override', {
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

  console.warn('[underchat-passkey-helper] navigation.blocked', { domain });
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
  context: PasskeyDeepLinkContext,
  details: Record<string, unknown> = {}
): void {
  console.log('[underchat-passkey-helper]', event, {
    ...details,
    tokenHash: context.tokenHash,
  });
}
