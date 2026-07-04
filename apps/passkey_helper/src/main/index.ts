import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const isDevelopment = !app.isPackaged;

interface CurrentPairing {
  context: PasskeyDeepLinkContext;
  error: string | null;
  session: PasskeyHelperSession | null;
}

let mainWindow: BrowserWindow | null = null;
let currentPairing: CurrentPairing | null = null;

const apiClient = new PasskeyHelperApiClient();

app.setName('Underchat Passkey Helper');
app.setPath(
  'userData',
  process.platform === 'linux'
    ? join(app.getPath('appData'), 'underchat-passkey-helper')
    : join(app.getPath('appData'), 'Underchat Passkey Helper')
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

registerProtocol();
registerIpcHandlers();

app.on('second-instance', (_event, argv) => {
  const deepLink = extractDeepLinkFromArgv(argv);

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

function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PASSKEY_PROTOCOL, process.execPath, [
      resolve(process.argv[1] ?? ''),
    ]);
    return;
  }

  app.setAsDefaultProtocolClient(PASSKEY_PROTOCOL);
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
      mainWindow?.webContents.send('underchat-passkey:session-updated');
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
        target_provider: sessionPackage.target_provider,
      });
      const enrichedPackage = await enrichSecureSessionPackage(sessionPackage);
      const result = await apiClient.uploadSecureSession(
        currentPairing.context,
        enrichedPackage
      );
      currentPairing.session = await fetchPairingSession(
        currentPairing.context
      ).catch(() => currentPairing?.session ?? null);
      mainWindow?.webContents.send('underchat-passkey:session-updated');
      logEvent('secure_session.upload.done', currentPairing.context, {
        status: result.status ?? result.code ?? null,
      });
      return result;
    }
  );
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

  mainWindow = new BrowserWindow({
    backgroundColor: '#0f1519',
    height: 860,
    minHeight: 680,
    minWidth: 960,
    show: false,
    title: 'Underchat Passkey Helper',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:underchat-passkey-helper',
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
    width: 1180,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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

  mainWindow.loadURL(WHATSAPP_WEB_ORIGIN).catch((error: unknown) => {
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
  let domain = 'invalid-url';

  try {
    domain = new URL(rawUrl).hostname;
  } catch {
    // keep sanitized fallback
  }

  console.warn('[underchat-passkey-helper] navigation.blocked', { domain });
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
