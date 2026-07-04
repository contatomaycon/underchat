import type {
  PasskeyHelperActionResult,
  PasskeyHelperSessionPayload,
  SecureSessionPackage,
  UnderchatPasskeyBridge,
} from '../preload';
import overlayCss from './overlay.css?inline';

interface OverlayState {
  busy: boolean;
  connected: boolean;
  error: string | null;
  helperPayload: PasskeyHelperSessionPayload | null;
  message: string | null;
  whatsappReady: boolean;
}

const CONNECTED_CODES = new Set([200, 201]);
const CONFIRMATION_CODES = new Set([208]);
const TERMINAL_SECURE_STATUSES = new Set([
  'connected',
  'failed',
  'expired',
  'cancelled',
]);
const BUSY_SECURE_STATUSES = new Set([
  'uploading',
  'session_received',
  'importing',
]);
const AUTO_CONNECT_READY_CHECKS = 2;

let bridgeRef: UnderchatPasskeyBridge | null = null;
let rootElement: HTMLElement | null = null;
let readinessIntervalId: number | null = null;
let currentTokenHash: string | null = null;
let helperOpenedReported = false;
let waAuthenticatedReported = false;
let whatsappReadyStableCount = 0;
let autoConnectStarted = false;
let secureConnectInFlight = false;
let sessionRefreshInFlight = false;
let pendingSessionRefresh = false;
let state: OverlayState = {
  busy: false,
  connected: false,
  error: null,
  helperPayload: null,
  message: null,
  whatsappReady: false,
};

export function installUnderchatPasskeyOverlay(
  bridge: UnderchatPasskeyBridge
): void {
  bridgeRef = bridge;
  injectStyles();
  ensureRoot();
  render();
  refreshSession();

  bridge.onSessionUpdated(() => {
    refreshSession({ background: true });
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
      message: 'Buscando dados da verificacao...',
    });
  }

  try {
    const helperPayload = await bridgeRef.getSession();
    const nextTokenHash =
      helperPayload.tokenHash ?? helperPayload.session?.token_hash ?? null;

    if (nextTokenHash && nextTokenHash !== currentTokenHash) {
      resetSecureFlowRuntime(nextTokenHash);
    }

    const secureStatus = getSecureSessionStatus(helperPayload);
    const connected = secureStatus === 'connected' || state.connected;

    setState({
      busy: false,
      connected,
      error: helperPayload.error ?? helperPayload.session?.error ?? null,
      helperPayload,
      message: null,
    });

    if (helperPayload.mode === 'secure') {
      if (secureStatus === 'created') {
        void reportSecureStatus('helper_opened');
      }
      startWhatsappReadinessProbe();
    }
  } catch (error) {
    setState({
      busy: false,
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

function startWhatsappReadinessProbe(): void {
  if (readinessIntervalId !== null) {
    window.clearInterval(readinessIntervalId);
  }

  const probe = (): void => {
    const ready = detectWhatsAppAuthenticated({ strict: true });
    whatsappReadyStableCount = ready ? whatsappReadyStableCount + 1 : 0;
    const stableReady = whatsappReadyStableCount >= AUTO_CONNECT_READY_CHECKS;

    if (stableReady !== state.whatsappReady) {
      setState({ whatsappReady: stableReady });
    }

    if (stableReady) {
      void reportSecureStatus('wa_authenticated');
      maybeAutoConnectSecureSession();
    }
  };

  probe();
  readinessIntervalId = window.setInterval(probe, 1800);
}

async function connectToUnderchat(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  const publicKey = getPublicKeyFromState();

  if (!publicKey) {
    setState({
      error: 'A Underchat ainda nao enviou a chave publica de passkey.',
      message: null,
    });
    return;
  }

  setState({
    busy: true,
    error: null,
    message: 'Abra a chave de acesso e conclua a validacao do WhatsApp.',
  });

  try {
    const credentialJson = await bridgeRef.getPasskeyAssertion(publicKey);
    const result = await bridgeRef.sendPasskeyResponse(credentialJson);

    applyActionResult(result);
  } catch (error) {
    setState({
      busy: false,
      error: sanitizeOverlayError(error),
      message: null,
    });
  }
}

async function confirmPasskey(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  setState({
    busy: true,
    error: null,
    message: 'Enviando confirmacao para a Underchat...',
  });

  try {
    const result = await bridgeRef.confirmPasskey();

    applyActionResult(result);
  } catch (error) {
    setState({
      busy: false,
      error: sanitizeOverlayError(error),
      message: null,
    });
  }
}

function applyActionResult(result: PasskeyHelperActionResult): void {
  const code = typeof result.status === 'number' ? result.status : result.code;

  if (code && CONNECTED_CODES.has(code)) {
    setState({
      busy: false,
      connected: true,
      error: null,
      message: 'Conexao validada. Voce pode voltar para a Underchat.',
    });
    return;
  }

  if (code && CONFIRMATION_CODES.has(code)) {
    const confirmationCode =
      result.confirmationCode ??
      result.passkeyConfirmationCode ??
      result.passkey_confirmation_code ??
      state.helperPayload?.session?.confirmationCode ??
      state.helperPayload?.session?.passkey_confirmation_code;

    setState({
      busy: false,
      error: null,
      helperPayload: {
        ...state.helperPayload,
        session: {
          ...state.helperPayload?.session,
          confirmationCode,
          passkey_confirmation_code: confirmationCode,
        },
      },
      message: 'Confirme no celular se o codigo exibido e o mesmo.',
    });
    return;
  }

  setState({
    busy: false,
    connected: Boolean(result.connected),
    error: result.connected ? null : (result.message ?? null),
    message: result.connected
      ? 'Conexao validada. Voce pode voltar para a Underchat.'
      : null,
  });
}

function render(): void {
  if (!rootElement) {
    return;
  }

  if (state.helperPayload?.mode === 'secure') {
    renderSecureMode();
    return;
  }

  const payload = state.helperPayload;
  const session = payload?.session;
  const publicKey = getPublicKeyFromState();
  const confirmationCode =
    session?.confirmationCode ?? session?.passkey_confirmation_code;
  const tone = state.error
    ? 'error'
    : state.connected
      ? 'success'
      : publicKey
        ? 'ready'
        : 'waiting';
  const title = state.connected
    ? 'Underchat conectada'
    : confirmationCode
      ? 'Confirmacao pendente'
      : publicKey
        ? 'Chave de acesso pronta'
        : 'Aguardando passkey';
  const text = state.error
    ? state.error
    : (state.message ??
      (publicKey
        ? 'Use a sessao aberta neste WhatsApp Web para validar a chave de acesso.'
        : 'Abra este helper pelo botao da Underchat e mantenha o WhatsApp Web carregado.'));

  rootElement.innerHTML = `
    <section class="underchat-passkey-panel" aria-live="polite">
      <header class="underchat-passkey-header">
        <div>
          <h1 class="underchat-passkey-title">Underchat Passkey Helper</h1>
          <p class="underchat-passkey-subtitle">Sessao local do WhatsApp Web para verificacao segura.</p>
        </div>
        <span class="underchat-passkey-badge" title="${escapeHtml(payload?.tokenHash ?? 'sem-token')}">
          ${escapeHtml(payload?.tokenHash ?? 'sem token')}
        </span>
      </header>
      <div class="underchat-passkey-body">
        <div class="underchat-passkey-state" data-tone="${tone}">
          <span class="underchat-passkey-state-dot"></span>
          <div>
            <p class="underchat-passkey-state-title">${escapeHtml(title)}</p>
            <p class="underchat-passkey-state-text">${escapeHtml(text)}</p>
          </div>
        </div>
        ${confirmationCode ? renderConfirmationCode(confirmationCode) : ''}
        <div class="underchat-passkey-actions">
          ${
            confirmationCode
              ? `<button class="underchat-passkey-button" data-action="confirm" ${
                  state.busy ? 'disabled' : ''
                }>Confirmar codigo</button>`
              : `<button class="underchat-passkey-button" data-action="connect" ${
                  state.busy || !publicKey || state.connected ? 'disabled' : ''
                }>Conectar a Underchat</button>`
          }
          <button class="underchat-passkey-button underchat-passkey-secondary" data-action="refresh" ${
            state.busy ? 'disabled' : ''
          }>Atualizar</button>
        </div>
        <div class="underchat-passkey-meta">
          <span>Canal: ${escapeHtml(session?.channelName ?? session?.channel_name ?? 'nao informado')}</span>
          <span>Expira: ${escapeHtml(session?.expiresAt ?? session?.expires_at ?? 'nao informado')}</span>
        </div>
      </div>
    </section>
  `;

  rootElement
    .querySelector('[data-action="connect"]')
    ?.addEventListener('click', () => {
      connectToUnderchat();
    });
  rootElement
    .querySelector('[data-action="confirm"]')
    ?.addEventListener('click', () => {
      confirmPasskey();
    });
  rootElement
    .querySelector('[data-action="refresh"]')
    ?.addEventListener('click', () => {
      refreshSession();
    });
}

function renderSecureMode(): void {
  if (!rootElement) {
    return;
  }

  const payload = state.helperPayload;
  const session = payload?.session;
  const status = String(session?.status ?? 'helper_opened');
  const terminal = ['connected', 'failed', 'expired', 'cancelled'].includes(
    status
  );
  const tone = state.error
    ? 'error'
    : status === 'connected' || state.connected
      ? 'success'
      : state.whatsappReady
        ? 'ready'
        : 'waiting';
  const title = state.connected
    ? 'Underchat conectada'
    : state.whatsappReady
      ? 'WhatsApp Web conectado'
      : 'Entre no WhatsApp Web';
  const text = state.error
    ? state.error
    : (state.message ??
      (state.whatsappReady
        ? 'Sessao detectada. A Underchat vai conectar automaticamente.'
        : 'Use esta janela para entrar no WhatsApp Web. Se o WhatsApp pedir passkey, conclua normalmente aqui.'));

  rootElement.innerHTML = `
    <section class="underchat-passkey-panel" aria-live="polite">
      <header class="underchat-passkey-header">
        <div>
          <h1 class="underchat-passkey-title">Conexao segura Underchat</h1>
          <p class="underchat-passkey-subtitle">WhatsApp Web nativo com suporte a passkey.</p>
        </div>
        <span class="underchat-passkey-badge" title="${escapeHtml(payload?.tokenHash ?? session?.token_hash ?? 'sem-token')}">
          ${escapeHtml(payload?.tokenHash ?? session?.token_hash ?? 'sem token')}
        </span>
      </header>
      <div class="underchat-passkey-body">
        <div class="underchat-passkey-state" data-tone="${tone}">
          <span class="underchat-passkey-state-dot"></span>
          <div>
            <p class="underchat-passkey-state-title">${escapeHtml(title)}</p>
            <p class="underchat-passkey-state-text">${escapeHtml(text)}</p>
          </div>
        </div>
        <div class="underchat-passkey-actions">
          <button class="underchat-passkey-button" data-action="connect-secure" ${
            state.busy ||
            secureConnectInFlight ||
            !state.whatsappReady ||
            terminal ||
            BUSY_SECURE_STATUSES.has(status)
              ? 'disabled'
              : ''
          }>${secureConnectInFlight || BUSY_SECURE_STATUSES.has(status) ? 'Conectando...' : 'Conectar a Underchat'}</button>
          <button class="underchat-passkey-button underchat-passkey-secondary" data-action="refresh" ${
            state.busy ? 'disabled' : ''
          }>Atualizar</button>
        </div>
        <div class="underchat-passkey-meta">
          <span>Status: ${escapeHtml(status)}</span>
          <span>Expira: ${escapeHtml(session?.expiresAt ?? session?.expires_at ?? 'nao informado')}</span>
        </div>
      </div>
    </section>
  `;

  rootElement
    .querySelector('[data-action="connect-secure"]')
    ?.addEventListener('click', () => {
      connectSecureSessionToUnderchat({ automatic: false });
    });
  rootElement
    .querySelector('[data-action="refresh"]')
    ?.addEventListener('click', () => {
      refreshSession();
    });
}

async function connectSecureSessionToUnderchat(
  options: { automatic?: boolean } = {}
): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  if (secureConnectInFlight) {
    console.log('[underchat-passkey-helper] secure_session.connect.skipped', {
      reason: 'already_in_flight',
    });
    return;
  }

  if (TERMINAL_SECURE_STATUSES.has(getSecureSessionStatus())) {
    return;
  }

  if (!detectWhatsAppAuthenticated({ strict: true })) {
    setState({
      error: 'O WhatsApp Web ainda nao parece autenticado nesta janela.',
      message: null,
      whatsappReady: false,
    });
    return;
  }

  secureConnectInFlight = true;
  if (options.automatic) {
    autoConnectStarted = true;
  }

  setState({
    busy: true,
    error: null,
    message: options.automatic
      ? 'WhatsApp detectado. Conectando automaticamente a Underchat...'
      : 'Preparando pacote da sessao autenticada...',
  });

  try {
    console.log('[underchat-passkey-helper] secure_session.connect.start', {
      automatic: Boolean(options.automatic),
      status: getSecureSessionStatus(),
      tokenHash: getTokenHashFromState(),
    });
    await bridgeRef.updateSecureStatus({ status: 'uploading' });
    console.log(
      '[underchat-passkey-helper] secure_session.package.collect.start'
    );
    const sessionPackage = await collectSecureSessionPackage();
    console.log(
      '[underchat-passkey-helper] secure_session.package.collect.done',
      {
        hasPayload: sessionPackage.payload !== undefined,
        localStorageKeys: countPayloadLocalStorageKeys(sessionPackage.payload),
        webVersion: sessionPackage.web_version ?? null,
      }
    );
    const result = await bridgeRef.sendSecureSessionPackage(sessionPackage);
    console.log('[underchat-passkey-helper] secure_session.upload.done', {
      connected: Boolean(result.connected),
      status: result.status ?? result.code ?? null,
    });

    const connected =
      result.status === 'connected' || result.connected === true;
    setState({
      busy: false,
      connected,
      error: connected ? null : (result.error ?? result.message ?? null),
      message: connected
        ? 'Sessao enviada. Voce pode voltar para a Underchat.'
        : 'A Underchat recebeu a sessao, mas ainda nao confirmou a conexao.',
    });
  } catch (error) {
    setState({
      busy: false,
      error: sanitizeOverlayError(error),
      message: null,
    });
    await bridgeRef.updateSecureStatus({
      error: sanitizeOverlayError(error),
      status: 'failed',
    });
  } finally {
    secureConnectInFlight = false;
  }
}

function detectWhatsAppAuthenticated(
  options: { strict?: boolean } = {}
): boolean {
  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    return false;
  }

  const blockingSelectors = [
    'canvas[aria-label*="Scan"]',
    '[data-testid="qrcode"]',
    '[data-ref] canvas',
    'input[name="phone"]',
  ];
  const hasBlockingLoginUi = blockingSelectors.some((selector) =>
    document.querySelector(selector)
  );
  const selectors = [
    '#side',
    '[data-testid="chat-list"]',
    '[data-testid="conversation-list"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[aria-label="Chat list"]',
    '[aria-label="Lista de conversas"]',
    '[contenteditable="true"][role="textbox"]',
  ];

  if (
    !hasBlockingLoginUi &&
    selectors.some((selector) => document.querySelector(selector))
  ) {
    return true;
  }

  if (options.strict) {
    return false;
  }

  try {
    return Object.keys(localStorage).some((key) =>
      /wa|wawc|whatsapp|last-wid|multi-device/i.test(key)
    );
  } catch {
    return false;
  }
}

async function reportSecureStatus(
  status: 'helper_opened' | 'wa_authenticated'
) {
  if (!bridgeRef || state.helperPayload?.mode !== 'secure') {
    return;
  }

  if (status === 'helper_opened') {
    if (helperOpenedReported) return;
    helperOpenedReported = true;
  }

  if (status === 'wa_authenticated') {
    if (waAuthenticatedReported) return;
    waAuthenticatedReported = true;
  }

  try {
    console.log('[underchat-passkey-helper] secure_session.status.report', {
      status,
      tokenHash: getTokenHashFromState(),
    });
    await bridgeRef.updateSecureStatus({ status });
  } catch (error) {
    console.warn(
      '[underchat-passkey-helper] secure_session.status.report.error',
      sanitizeOverlayError(error)
    );
  }
}

function maybeAutoConnectSecureSession(): void {
  if (
    !bridgeRef ||
    state.helperPayload?.mode !== 'secure' ||
    autoConnectStarted ||
    secureConnectInFlight ||
    !state.whatsappReady
  ) {
    return;
  }

  const status = getSecureSessionStatus();
  if (
    TERMINAL_SECURE_STATUSES.has(status) ||
    BUSY_SECURE_STATUSES.has(status)
  ) {
    return;
  }

  autoConnectStarted = true;
  void connectSecureSessionToUnderchat({ automatic: true });
}

async function collectSecureSessionPackage(): Promise<SecureSessionPackage> {
  const localStorageSnapshot: Record<string, string> = {};

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value !== null) {
        localStorageSnapshot[key] = value;
      }
    }
  } catch {
    // The importers can still use cookies/profile data captured by Electron.
  }

  const indexedDbNames =
    typeof indexedDB.databases === 'function'
      ? await indexedDB
          .databases()
          .then((databases) =>
            databases
              .map((database) => database.name)
              .filter((name): name is string => Boolean(name))
          )
          .catch(() => [])
      : [];

  return {
    created_at: new Date().toISOString(),
    format_version: 'underchat-wa-web-session-v1',
    payload: {
      href: location.href,
      indexed_db_names: indexedDbNames,
      local_storage: localStorageSnapshot,
      user_agent: navigator.userAgent,
    },
    source: 'whatsapp_web',
    target_provider: 'auto',
    web_version: readWhatsAppWebVersion(),
  };
}

function getSecureSessionStatus(
  payload: PasskeyHelperSessionPayload | null = state.helperPayload
): string {
  return String(payload?.session?.status ?? 'helper_opened');
}

function getTokenHashFromState(): string | null {
  return (
    state.helperPayload?.tokenHash ??
    state.helperPayload?.session?.token_hash ??
    null
  );
}

function resetSecureFlowRuntime(tokenHash: string): void {
  currentTokenHash = tokenHash;
  helperOpenedReported = false;
  waAuthenticatedReported = false;
  whatsappReadyStableCount = 0;
  autoConnectStarted = false;
  secureConnectInFlight = false;
  console.log('[underchat-passkey-helper] secure_session.runtime.reset', {
    tokenHash,
  });
}

function countPayloadLocalStorageKeys(payload: unknown): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 0;
  }

  const localStorageValue = (payload as Record<string, unknown>).local_storage;
  if (
    !localStorageValue ||
    typeof localStorageValue !== 'object' ||
    Array.isArray(localStorageValue)
  ) {
    return 0;
  }

  return Object.keys(localStorageValue).length;
}

function readWhatsAppWebVersion(): string | undefined {
  const versionSource = [
    document.querySelector('meta[name="version"]')?.getAttribute('content'),
    document.documentElement.getAttribute('data-app-version'),
  ].find((value) => value && value.trim());

  return versionSource?.trim();
}

function renderConfirmationCode(code: string): string {
  const cells = code
    .slice(0, 12)
    .split('')
    .map(
      (char) =>
        `<span class="underchat-passkey-code-cell">${escapeHtml(char)}</span>`
    )
    .join('');

  return `<div class="underchat-passkey-code" aria-label="Codigo de confirmacao">${cells}</div>`;
}

function getPublicKeyFromState(): unknown {
  return (
    state.helperPayload?.session?.publicKey ??
    state.helperPayload?.session?.passkeyPublicKey ??
    state.helperPayload?.session?.passkey_public_key ??
    null
  );
}

function setState(nextState: Partial<OverlayState>): void {
  state = {
    ...state,
    ...nextState,
  };
  render();
}

function ensureRoot(): void {
  rootElement = document.querySelector('#underchat-passkey-helper-root');

  if (rootElement) {
    return;
  }

  rootElement = document.createElement('div');
  rootElement.id = 'underchat-passkey-helper-root';
  document.documentElement.appendChild(rootElement);
}

function injectStyles(): void {
  if (document.querySelector('#underchat-passkey-helper-style')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'underchat-passkey-helper-style';
  style.textContent = overlayCss;
  document.documentElement.appendChild(style);
}

function sanitizeOverlayError(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (
      /fetch failed|ECONNREFUSED|Failed to fetch|update-secure-status/i.test(
        error.message
      )
    ) {
      return 'Underchat indisponivel. Mantenha a tela aberta e tente atualizar.';
    }

    return error.message;
  }

  return 'Nao foi possivel concluir a verificacao.';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
