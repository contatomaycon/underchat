import type {
  AuthenticatorSessionPayload,
  UnderchatAuthenticatorBridge,
} from '../preload';
import overlayCss from './overlay.css?inline';

interface OverlayState {
  busy: boolean;
  chromeMissing: boolean;
  connected: boolean;
  diagnosticsEnabled: boolean;
  diagnosticsMessage: string | null;
  error: string | null;
  helperPayload: AuthenticatorSessionPayload | null;
  message: string | null;
}

type StepState = 'done' | 'current' | 'pending' | 'error';

const TERMINAL_SECURE_STATUSES = new Set([
  'connected_confirmed',
  'failed',
  'expired',
  'cancelled',
]);
const BUSY_SECURE_STATUSES = new Set([
  'uploading',
  'session_received',
  'importing',
  'validating_worker',
  'connected',
]);
const AUTO_START_ALLOWED_STATUSES = new Set([
  'created',
  'helper_opened',
  'wa_authenticated',
  'wa_syncing',
  'wa_ready',
]);

let bridgeRef: UnderchatAuthenticatorBridge | null = null;
let rootElement: HTMLElement | null = null;
let currentTokenHash: string | null = null;
let controlledBrowserInFlight = false;
let sessionRefreshInFlight = false;
let pendingSessionRefresh = false;
let statusPollingIntervalId: number | null = null;
let helperAutoCloseTimerId: number | null = null;
const autoStartedTokenHashes = new Set<string>();

let state: OverlayState = {
  busy: false,
  chromeMissing: false,
  connected: false,
  diagnosticsEnabled: false,
  diagnosticsMessage: null,
  error: null,
  helperPayload: null,
  message: null,
};

export function installUnderchatAuthenticatorOverlay(
  bridge: UnderchatAuthenticatorBridge
): void {
  bridgeRef = bridge;
  injectStyles();
  ensureRoot();
  render();
  void refreshSession();
  bridge
    .getDiagnosticsInfo()
    .then((info) => {
      setState({ diagnosticsEnabled: info.enabled });
      recordDebugLog('diagnostics.info.loaded', {
        channel: info.channel,
        enabled: info.enabled,
      });
    })
    .catch(() => undefined);

  bridge.onSessionUpdated(() => {
    void refreshSession({ background: true });
  });
}

async function refreshSession(
  options: { background?: boolean } = {}
): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  if (sessionRefreshInFlight) {
    pendingSessionRefresh = true;
    return;
  }

  sessionRefreshInFlight = true;

  if (!options.background && !state.helperPayload) {
    setState({
      busy: true,
      error: null,
      message: 'Preparando verificação segura...',
    });
  }

  try {
    const helperPayload = await bridgeRef.getSession();
    const nextTokenHash = getTokenHash(helperPayload);

    if (nextTokenHash && nextTokenHash !== currentTokenHash) {
      resetRuntime(nextTokenHash);
    }

    const secureStatus = getSecureSessionStatus(helperPayload);
    const connected = secureStatus === 'connected_confirmed' || state.connected;

    setState({
      busy: false,
      connected,
      error: helperPayload.error ?? helperPayload.session?.error ?? state.error,
      helperPayload,
      message: null,
    });

    if (helperPayload.mode === 'secure') {
      if (TERMINAL_SECURE_STATUSES.has(secureStatus)) {
        stopStatusPolling();
      }
      if (secureStatus === 'connected_confirmed') {
        scheduleHelperAutoClose();
      }
      maybeStartChromeAutomatically(helperPayload);
    }
  } catch (error) {
    setState({
      busy: false,
      chromeMissing: isChromeMissingError(error),
      error: sanitizeOverlayError(error),
      message: null,
    });
  } finally {
    sessionRefreshInFlight = false;

    if (pendingSessionRefresh) {
      pendingSessionRefresh = false;
      void refreshSession({ background: true });
    }
  }
}

function maybeStartChromeAutomatically(
  helperPayload: AuthenticatorSessionPayload
): void {
  const tokenHash = getTokenHash(helperPayload);
  if (!tokenHash || autoStartedTokenHashes.has(tokenHash)) {
    return;
  }

  const status = getSecureSessionStatus(helperPayload);
  if (
    controlledBrowserInFlight ||
    TERMINAL_SECURE_STATUSES.has(status) ||
    BUSY_SECURE_STATUSES.has(status) ||
    !AUTO_START_ALLOWED_STATUSES.has(status)
  ) {
    return;
  }

  autoStartedTokenHashes.add(tokenHash);
  void startControlledBrowserSession({ automatic: true });
}

async function startControlledBrowserSession(
  options: { automatic?: boolean } = {}
): Promise<void> {
  if (!bridgeRef || controlledBrowserInFlight) {
    return;
  }

  const status = getSecureSessionStatus();
  if (
    TERMINAL_SECURE_STATUSES.has(status) ||
    BUSY_SECURE_STATUSES.has(status)
  ) {
    return;
  }

  controlledBrowserInFlight = true;
  setState({
    busy: true,
    chromeMissing: false,
    diagnosticsMessage: null,
    error: null,
    message: options.automatic
      ? 'Abrindo o Google Chrome automaticamente...'
      : 'Abrindo o Google Chrome...',
  });
  startStatusPolling();
  let keepPolling = false;

  try {
    recordDebugLog('secure_session.chrome.start', {
      automatic: Boolean(options.automatic),
      status,
      tokenHash: currentTokenHash,
    });
    const result = await bridgeRef.startControlledBrowser();
    const connected = result.status === 'connected_confirmed';
    keepPolling = !connected;

    setState({
      busy: false,
      chromeMissing: false,
      connected,
      error: connected ? null : (result.error ?? null),
      message: connected
        ? 'Sessão conectada. O Authenticator será fechado em instantes.'
        : (result.message ??
          'Sessão recebida. A Underchat ainda está validando o canal.'),
    });

    if (connected) {
      scheduleHelperAutoClose();
    }
  } catch (error) {
    const chromeMissing = isChromeMissingError(error);
    setState({
      busy: false,
      chromeMissing,
      error: chromeMissing
        ? 'Google Chrome não encontrado. Instale o Chrome e tente novamente.'
        : sanitizeOverlayError(error),
      message: null,
    });
  } finally {
    controlledBrowserInFlight = false;
    if (!keepPolling) {
      stopStatusPolling();
    }
    render();
  }
}

async function openChromeDownloadPage(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  try {
    await bridgeRef.openChromeDownloadPage();
  } catch (error) {
    setState({
      diagnosticsMessage: sanitizeOverlayError(error),
    });
  }
}

async function downloadDebugLog(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  try {
    recordDebugLog('diagnostic_log.download.requested', {
      status: getSecureSessionStatus(),
      tokenHash: currentTokenHash,
    });
    const result = await bridgeRef.downloadDebugLog();
    setState({
      diagnosticsMessage:
        result.status === 'saved'
          ? `Log salvo em: ${result.message ?? 'arquivo selecionado'}`
          : result.status === 'cancelled'
            ? 'Download do log cancelado.'
            : (result.message ?? 'Não foi possível salvar o log.'),
    });
  } catch (error) {
    setState({
      diagnosticsMessage: sanitizeOverlayError(error),
    });
  }
}

function startStatusPolling(): void {
  stopStatusPolling();
  statusPollingIntervalId = window.setInterval(() => {
    void refreshSession({ background: true });
  }, 2500);
}

function stopStatusPolling(): void {
  if (statusPollingIntervalId !== null) {
    window.clearInterval(statusPollingIntervalId);
    statusPollingIntervalId = null;
  }
}

function scheduleHelperAutoClose(): void {
  if (!bridgeRef || helperAutoCloseTimerId !== null) {
    return;
  }

  helperAutoCloseTimerId = window.setTimeout(() => {
    helperAutoCloseTimerId = null;
    void bridgeRef?.closeHelper().catch((error) => {
      recordDebugLog('helper.auto_close.error', {
        reason: sanitizeOverlayError(error),
      });
    });
  }, 1800);
}

function render(): void {
  if (!rootElement) {
    return;
  }

  const payload = state.helperPayload;
  const session = payload?.session;
  const status = getSecureSessionStatus(payload);
  const connected = status === 'connected_confirmed' || state.connected;
  const terminal = TERMINAL_SECURE_STATUSES.has(status);
  const busy =
    state.busy || controlledBrowserInFlight || BUSY_SECURE_STATUSES.has(status);
  const statusView = getStatusView(status);
  const canRetry =
    payload?.mode === 'secure' &&
    !busy &&
    (!terminal ||
      status === 'failed' ||
      status === 'expired' ||
      status === 'cancelled');

  rootElement.innerHTML = `
    <section class="auth-app" aria-live="polite">
      <header class="auth-header">
        <div class="auth-mark" aria-hidden="true">
          <span>UC</span>
        </div>
        <div>
          <p class="auth-kicker">Underchat Authenticator</p>
          <h1>Conectar WhatsApp</h1>
        </div>
      </header>

      <div class="auth-status" data-tone="${escapeHtml(statusView.tone)}">
        <div class="auth-status-indicator" aria-hidden="true"></div>
        <div>
          <p class="auth-status-label">${escapeHtml(statusView.label)}</p>
          <p class="auth-status-text">${escapeHtml(state.error ?? state.message ?? statusView.text)}</p>
        </div>
      </div>

      <ol class="auth-steps" aria-label="Progresso da conexão">
        ${renderStep('1', 'Abrir Chrome', getStepState(1, status, connected))}
        ${renderStep('2', 'Autenticar WhatsApp', getStepState(2, status, connected))}
        ${renderStep('3', 'Importar sessão', getStepState(3, status, connected))}
      </ol>

      <div class="auth-panel">
        <p class="auth-panel-title">${escapeHtml(getPanelTitle())}</p>
        <p class="auth-panel-text">${escapeHtml(getPanelText())}</p>
      </div>

      <div class="auth-actions">
        ${
          state.chromeMissing
            ? `<button class="auth-button auth-button-primary" data-action="download-chrome" type="button">Baixar Chrome</button>`
            : ''
        }
        ${
          canRetry
            ? `<button class="auth-button ${state.chromeMissing ? 'auth-button-secondary' : 'auth-button-primary'}" data-action="open-chrome" type="button">${state.chromeMissing ? 'Tentar novamente' : 'Abrir Chrome'}</button>`
            : ''
        }
        ${
          !canRetry && !connected && payload?.mode === 'secure'
            ? `<button class="auth-button auth-button-primary" type="button" disabled>${controlledBrowserInFlight ? 'Abrindo Chrome...' : statusView.actionLabel}</button>`
            : ''
        }
        ${
          state.diagnosticsEnabled
            ? `<button class="auth-button auth-button-secondary" data-action="download-log" type="button">Baixar log</button>`
            : ''
        }
      </div>

      ${
        state.diagnosticsMessage
          ? `<p class="auth-debug">${escapeHtml(state.diagnosticsMessage)}</p>`
          : ''
      }

      <footer class="auth-footer">
        <span>${escapeHtml(session?.channelName ?? session?.channel_name ?? 'Canal seguro')}</span>
        <span>${escapeHtml(formatTokenLabel(payload))}</span>
      </footer>
    </section>
  `;

  rootElement
    .querySelector('[data-action="open-chrome"]')
    ?.addEventListener('click', () => {
      void startControlledBrowserSession({ automatic: false });
    });
  rootElement
    .querySelector('[data-action="download-chrome"]')
    ?.addEventListener('click', () => {
      void openChromeDownloadPage();
    });
  rootElement
    .querySelector('[data-action="download-log"]')
    ?.addEventListener('click', () => {
      void downloadDebugLog();
    });
}

function renderStep(
  index: string,
  label: string,
  stepState: StepState
): string {
  return `
    <li class="auth-step" data-state="${stepState}">
      <span class="auth-step-index">${index}</span>
      <span>${escapeHtml(label)}</span>
    </li>
  `;
}

function getStepState(
  step: 1 | 2 | 3,
  status: string,
  connected: boolean
): StepState {
  if (state.chromeMissing && step === 1) {
    return 'error';
  }
  if (connected) {
    return 'done';
  }

  const uploadStatuses = new Set([
    'uploading',
    'session_received',
    'importing',
    'validating_worker',
    'connected',
  ]);
  const whatsappStatuses = new Set([
    'wa_authenticated',
    'wa_syncing',
    'wa_ready',
  ]);

  if (step === 1) {
    return whatsappStatuses.has(status) || uploadStatuses.has(status)
      ? 'done'
      : 'current';
  }
  if (step === 2) {
    if (uploadStatuses.has(status)) {
      return 'done';
    }
    return whatsappStatuses.has(status) ? 'current' : 'pending';
  }

  return uploadStatuses.has(status) ? 'current' : 'pending';
}

function getStatusView(status: string): {
  actionLabel: string;
  label: string;
  text: string;
  tone: 'error' | 'success' | 'syncing' | 'waiting';
} {
  if (state.chromeMissing) {
    return {
      actionLabel: 'Instale o Chrome',
      label: 'Chrome não encontrado',
      text: 'Instale o Google Chrome e tente abrir a conexão novamente.',
      tone: 'error',
    };
  }
  if (state.error) {
    return {
      actionLabel: 'Aguardando ação',
      label: 'Ação necessária',
      text: state.error,
      tone: 'error',
    };
  }
  if (status === 'connected_confirmed' || state.connected) {
    return {
      actionLabel: 'Conectado',
      label: 'WhatsApp conectado',
      text: 'Sessão validada pela Underchat. O helper será fechado automaticamente.',
      tone: 'success',
    };
  }
  if (status === 'uploading' || status === 'session_received') {
    return {
      actionLabel: 'Enviando...',
      label: 'Enviando sessão',
      text: 'A sessão autenticada está sendo enviada para a Underchat.',
      tone: 'syncing',
    };
  }
  if (
    status === 'importing' ||
    status === 'validating_worker' ||
    status === 'connected'
  ) {
    return {
      actionLabel: 'Validando...',
      label: 'Validando canal',
      text: 'A Underchat está restaurando a sessão e verificando o worker.',
      tone: 'syncing',
    };
  }
  if (status === 'wa_syncing') {
    return {
      actionLabel: 'Sincronizando...',
      label: 'Sincronizando WhatsApp',
      text: 'Mantenha o WhatsApp aberto até a sincronização inicial terminar.',
      tone: 'syncing',
    };
  }
  if (status === 'wa_authenticated' || status === 'wa_ready') {
    return {
      actionLabel: 'Preparando...',
      label: 'WhatsApp autenticado',
      text: 'Capturando a sessão pelo Chrome controlado.',
      tone: 'syncing',
    };
  }
  if (controlledBrowserInFlight) {
    return {
      actionLabel: 'Abrindo...',
      label: 'Chrome aberto',
      text: 'Use o WhatsApp Web no Google Chrome para concluir a autenticação.',
      tone: 'waiting',
    };
  }

  return {
    actionLabel: 'Abrindo...',
    label: 'Iniciando conexão',
    text: 'O Google Chrome será aberto automaticamente para autenticar o WhatsApp.',
    tone: 'waiting',
  };
}

function getPanelTitle(): string {
  if (state.chromeMissing) {
    return 'Google Chrome é necessário';
  }
  if (state.connected) {
    return 'Conexão concluída';
  }
  if (controlledBrowserInFlight) {
    return 'Continue no Chrome';
  }
  return 'Janela de controle';
}

function getPanelText(): string {
  if (state.chromeMissing) {
    return 'O Authenticator usa o Chrome externo para mostrar a opção de passkey por smartphone ou tablet.';
  }
  if (state.connected) {
    return 'A sessão temporária será removida e esta janela será fechada.';
  }
  if (controlledBrowserInFlight) {
    return 'Esta janela só acompanha o progresso. Não é necessário escanear nada aqui.';
  }
  return 'Se o Chrome não abrir sozinho, use o botão para tentar novamente.';
}

function recordDebugLog(
  event: string,
  details: Record<string, unknown> = {}
): void {
  void bridgeRef?.appendDebugLog(event, details).catch(() => undefined);
}

function getSecureSessionStatus(
  payload: AuthenticatorSessionPayload | null = state.helperPayload
): string {
  return String(payload?.session?.status ?? 'created');
}

function getTokenHash(
  payload: AuthenticatorSessionPayload | null
): string | null {
  return payload?.tokenHash ?? payload?.session?.token_hash ?? null;
}

function formatTokenLabel(payload: AuthenticatorSessionPayload | null): string {
  const tokenHash = getTokenHash(payload);
  return tokenHash ? `Token ${tokenHash}` : 'Aguardando token';
}

function resetRuntime(tokenHash: string): void {
  stopStatusPolling();
  if (helperAutoCloseTimerId !== null) {
    window.clearTimeout(helperAutoCloseTimerId);
    helperAutoCloseTimerId = null;
  }

  currentTokenHash = tokenHash;
  controlledBrowserInFlight = false;
  state.chromeMissing = false;
  state.connected = false;
  state.error = null;
  state.message = null;
  recordDebugLog('secure_session.runtime.reset', { tokenHash });
}

function isChromeMissingError(error: unknown): boolean {
  return /Google Chrome não encontrado|Chrome não encontrado|Instale o Chrome/i.test(
    sanitizeOverlayError(error)
  );
}

function sanitizeOverlayError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function setState(nextState: Partial<OverlayState>): void {
  state = {
    ...state,
    ...nextState,
  };
  render();
}

function ensureRoot(): void {
  rootElement = document.querySelector('#underchat-authenticator-root');

  if (rootElement) {
    return;
  }

  rootElement = document.createElement('main');
  rootElement.id = 'underchat-authenticator-root';
  document.body.appendChild(rootElement);
}

function injectStyles(): void {
  if (document.querySelector('#underchat-authenticator-style')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'underchat-authenticator-style';
  style.textContent = overlayCss;
  document.head.appendChild(style);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
