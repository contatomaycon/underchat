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
  diagnosticsEnabled: boolean;
  diagnosticsMessage: string | null;
  error: string | null;
  helperPayload: PasskeyHelperSessionPayload | null;
  message: string | null;
  whatsappReady: boolean;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface BufferJsonWrapper {
  data: string;
  type: 'Buffer';
}

interface WhatsAppWebExtractedCreds {
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
}

interface WhatsAppWebAuthDump {
  _debug?: JsonRecord[];
  appStateSyncKeyCount: number;
  appStateVersionCount: number;
  creds: WhatsAppWebExtractedCreds;
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
const WORKER_TYPE_PROVIDER_MAP: Record<
  string,
  SecureSessionPackage['target_provider']
> = {
  '019a930d-c6f6-766d-9c84-53307d4159a1': 'baileys',
  '019a930d-c6f6-766d-9c84-62b9c3e7d1f0': 'wwebjs',
  'e80ad183-2b46-4628-9105-a036f2d28720': 'whatsmeow',
};

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
let automaticExtractionRetryTimerId: number | null = null;
let helperAutoCloseTimerId: number | null = null;
let secureUploadPollingIntervalId: number | null = null;
let secureUploadWatchdogTimerId: number | null = null;
let isolatedWorldAuthExtractionDebug: JsonRecord[] = [];
let state: OverlayState = {
  busy: false,
  connected: false,
  diagnosticsEnabled: false,
  diagnosticsMessage: null,
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
      if (TERMINAL_SECURE_STATUSES.has(secureStatus)) {
        stopSecureUploadStatusPolling();
      }
      if (secureStatus === 'connected') {
        scheduleHelperAutoClose();
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
          ${
            state.diagnosticsEnabled
              ? `<button class="underchat-passkey-button underchat-passkey-secondary" data-action="download-log">Baixar log</button>`
              : ''
          }
        </div>
        ${
          state.diagnosticsMessage
            ? `<p class="underchat-passkey-debug-message">${escapeHtml(state.diagnosticsMessage)}</p>`
            : ''
        }
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
  rootElement
    .querySelector('[data-action="download-log"]')
    ?.addEventListener('click', () => {
      downloadDebugLog();
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
    diagnosticsMessage: null,
    error: null,
    message: options.automatic
      ? 'WhatsApp detectado. Conectando automaticamente a Underchat...'
      : 'Preparando pacote da sessao autenticada...',
  });
  startSecureUploadStatusPolling();

  try {
    recordDebugLog('secure_session.connect.start', {
      automatic: Boolean(options.automatic),
      status: getSecureSessionStatus(),
      tokenHash: getTokenHashFromState(),
    });
    console.log('[underchat-passkey-helper] secure_session.connect.start', {
      automatic: Boolean(options.automatic),
      status: getSecureSessionStatus(),
      tokenHash: getTokenHashFromState(),
    });
    recordDebugLog('secure_session.package.collect.start');
    setState({
      message: 'Extraindo a sessao autenticada do WhatsApp Web...',
    });
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
    recordDebugLog('secure_session.package.collect.done', {
      hasPayload: sessionPackage.payload !== undefined,
      localStorageKeys: countPayloadLocalStorageKeys(sessionPackage.payload),
      targetProvider: sessionPackage.target_provider,
      webVersion: sessionPackage.web_version ?? null,
    });
    setState({
      message: 'Enviando sessao autenticada para a Underchat...',
    });
    await bridgeRef.updateSecureStatus({ status: 'uploading' });
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
        ? 'Sessao conectada na Underchat. Fechando o helper...'
        : 'A Underchat recebeu a sessao, mas ainda nao confirmou a conexao.',
    });
    if (connected) {
      scheduleHelperAutoClose();
    }
  } catch (error) {
    const sanitizedError = sanitizeOverlayError(error);
    const extractionError = isSecureSessionExtractionError(sanitizedError);
    setState({
      busy: false,
      error: sanitizedError,
      message: null,
    });

    if (options.automatic && extractionError) {
      scheduleAutomaticExtractionRetry();
    }

    await bridgeRef.updateSecureStatus({
      error: sanitizedError,
      status: extractionError ? 'wa_authenticated' : 'failed',
    });
  } finally {
    stopSecureUploadStatusPolling();
    secureConnectInFlight = false;
  }
}

async function downloadDebugLog(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  try {
    recordDebugLog('diagnostic_log.download.requested', {
      status: getSecureSessionStatus(),
      tokenHash: getTokenHashFromState(),
    });
    const result = await bridgeRef.downloadDebugLog();
    setState({
      diagnosticsMessage:
        result.status === 'saved'
          ? `Log salvo em: ${result.message ?? 'arquivo selecionado'}`
          : result.status === 'cancelled'
            ? 'Download do log cancelado.'
            : (result.message ?? 'Nao foi possivel salvar o log.'),
    });
  } catch (error) {
    setState({
      diagnosticsMessage: sanitizeOverlayError(error),
    });
  }
}

function recordDebugLog(
  event: string,
  details: Record<string, unknown> = {}
): void {
  void bridgeRef?.appendDebugLog(event, details).catch(() => undefined);
}

function pushAuthExtractionDebug(
  event: string,
  details: Record<string, unknown> = {}
): void {
  isolatedWorldAuthExtractionDebug.push({ details, event });
}

function summarizeRecordKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).slice(0, 40).sort() : [];
}

function summarizeBytePair(
  pair: { private: Uint8Array; public: Uint8Array } | null
): JsonRecord | null {
  return pair
    ? {
        plausible: isPlausibleNoiseKeyPair(pair.private, pair.public),
        priv_len: pair.private.length,
        pub_len: pair.public.length,
      }
    : null;
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
    const currentStatus = getSecureSessionStatus();
    if (
      currentStatus !== 'created' &&
      currentStatus !== 'helper_opened' &&
      currentStatus !== 'wa_authenticated'
    ) {
      return;
    }
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

function scheduleAutomaticExtractionRetry(): void {
  if (automaticExtractionRetryTimerId !== null) {
    return;
  }

  automaticExtractionRetryTimerId = window.setTimeout(() => {
    automaticExtractionRetryTimerId = null;
    autoConnectStarted = false;
    maybeAutoConnectSecureSession();
  }, 10_000);
}

function startSecureUploadStatusPolling(): void {
  stopSecureUploadStatusPolling();

  secureUploadWatchdogTimerId = window.setTimeout(() => {
    const status = getSecureSessionStatus();
    recordDebugLog('secure_session.upload.watchdog', {
      status,
      tokenHash: getTokenHashFromState(),
    });
    setState({
      message:
        status === 'uploading' || BUSY_SECURE_STATUSES.has(status)
          ? state.diagnosticsEnabled
            ? 'Importacao ainda em andamento. Se continuar assim, clique em Baixar log para analisar o fluxo.'
            : 'Importacao ainda em andamento. Aguarde a resposta da Underchat.'
          : state.diagnosticsEnabled
            ? 'Extracao da sessao demorou mais que o esperado. Clique em Baixar log se continuar assim.'
            : 'Extracao da sessao demorou mais que o esperado.',
    });
  }, 18_000);

  secureUploadPollingIntervalId = window.setInterval(() => {
    void refreshSession({ background: true });
  }, 2500);
}

function stopSecureUploadStatusPolling(): void {
  if (secureUploadPollingIntervalId !== null) {
    window.clearInterval(secureUploadPollingIntervalId);
    secureUploadPollingIntervalId = null;
  }

  if (secureUploadWatchdogTimerId !== null) {
    window.clearTimeout(secureUploadWatchdogTimerId);
    secureUploadWatchdogTimerId = null;
  }
}

function scheduleHelperAutoClose(): void {
  if (!bridgeRef || helperAutoCloseTimerId !== null) {
    return;
  }

  console.log('[underchat-passkey-helper] helper.auto_close.scheduled', {
    tokenHash: getTokenHashFromState(),
    status: getSecureSessionStatus(),
  });
  helperAutoCloseTimerId = window.setTimeout(() => {
    helperAutoCloseTimerId = null;
    void bridgeRef?.closeHelper().catch((error) => {
      console.warn(
        '[underchat-passkey-helper] helper.auto_close.error',
        sanitizeOverlayError(error)
      );
    });
  }, 1800);
}

function isSecureSessionExtractionError(message: string): boolean {
  return /extrair|extract|auth_dump|noise key|identity key|signed pre-key|registrationId/i.test(
    message
  );
}

async function collectSecureSessionPackage(): Promise<SecureSessionPackage> {
  const targetProvider = getSecureSessionTargetProvider();
  const indexedDbNames = await listIndexedDbNames();
  const payload: JsonRecord = {
    href: location.href,
    indexed_db_names: indexedDbNames,
    user_agent: navigator.userAgent,
  };
  const needsWhatsAppWebCreds = targetProvider !== 'wwebjs';
  const authDump = needsWhatsAppWebCreds
    ? await extractWhatsAppWebAuthDump()
    : null;

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
        'creds.json': createBaileysCredsFile(authDump.creds),
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
    web_version: readWhatsAppWebVersion(),
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

  return value as unknown as WhatsAppWebAuthDump;
}

async function extractWhatsAppWebAuthDump(): Promise<WhatsAppWebAuthDump> {
  if (bridgeRef) {
    try {
      const pageWorldDump = await bridgeRef.extractWhatsAppWebAuthDump();
      const normalizedDump = normalizeWhatsAppWebAuthDump(pageWorldDump);

      if (normalizedDump) {
        return normalizedDump;
      }

      console.warn(
        '[underchat-passkey-helper] secure_session.auth_dump.page_world.invalid_shape'
      );
      recordDebugLog('secure_session.auth_dump.page_world.invalid_shape', {
        keys: summarizeRecordKeys(pageWorldDump),
      });
    } catch (error) {
      console.warn(
        '[underchat-passkey-helper] secure_session.auth_dump.page_world.error',
        sanitizeOverlayError(error)
      );
      recordDebugLog('secure_session.auth_dump.page_world.error', {
        reason: sanitizeOverlayError(error),
      });
    }
  }

  return extractWhatsAppWebAuthDumpFromIsolatedWorld();
}

async function extractWhatsAppWebAuthDumpFromIsolatedWorld(): Promise<WhatsAppWebAuthDump> {
  isolatedWorldAuthExtractionDebug = [];
  pushAuthExtractionDebug('isolated_world.start');

  const signalDb = await openIndexedDb('signal-storage');
  let metaRows: unknown[] = [];
  let signedPreKeyRows: unknown[] = [];

  try {
    [metaRows, signedPreKeyRows] = await Promise.all([
      getAllFromIndexedDbStore(signalDb, 'signal-meta-store'),
      getAllFromIndexedDbStore(signalDb, 'signed-prekey-store'),
    ]);
  } finally {
    signalDb.close();
  }
  pushAuthExtractionDebug('signal_db.rows', {
    meta_rows: metaRows.length,
    signed_prekey_rows: signedPreKeyRows.length,
  });

  const metaMap = createSignalMetaMap(metaRows);
  const registrationInfo = await getRegistrationInfoViaInternalModule();
  const staticPublicKey =
    (await decryptRegistrationMaterial(metaMap.signal_static_pubkey)) ??
    toUint8FromPath(registrationInfo, ['identityKeyPair', 'pubKey']);
  const staticPrivateKey =
    (await decryptRegistrationMaterial(metaMap.signal_static_privkey)) ??
    toUint8FromPath(registrationInfo, ['identityKeyPair', 'privKey']);
  const noise = await getNoiseInfoViaInternalModule();
  const signedPreKey = getLatestSignedPreKey(signedPreKeyRows);
  const account = extractAdvAccount(metaMap.adv_signed_identity);
  const registrationId =
    toPositiveInteger(metaMap.signal_reg_id) ??
    toPositiveInteger(getRecordValue(registrationInfo, 'registrationId')) ??
    toPositiveInteger(getRecordValue(registrationInfo, 'regId'));
  const meId = widToJid(readLocalStorageJson('last-wid-md'));
  const meLid = widToJid(readLocalStorageJson('WALid'));
  const meDisplayName = normalizeOptionalString(
    readLocalStorageJson('me-display-name')
  );

  if (!registrationId) {
    throwAuthExtractionError(
      'Nao foi possivel extrair o registrationId da sessao.'
    );
  }
  if (!noise) {
    throwAuthExtractionError('Nao foi possivel extrair a noise key da sessao.');
  }
  if (!staticPublicKey || !staticPrivateKey) {
    throwAuthExtractionError(
      'Nao foi possivel extrair a identity key da sessao.'
    );
  }
  if (!signedPreKey) {
    throwAuthExtractionError(
      'Nao foi possivel extrair a signed pre-key da sessao.'
    );
  }
  if (!account) {
    throwAuthExtractionError(
      'Nao foi possivel extrair a identidade ADV da sessao.'
    );
  }
  if (!meId) {
    throwAuthExtractionError('Nao foi possivel identificar o JID conectado.');
  }

  const [syncKeyRows, versionRows] = await Promise.all([
    getModelTableRows('WAWebSchemaSyncKeys', 'getSyncKeysTable'),
    getModelTableRows(
      'WAWebSchemaCollectionVersion',
      'getCollectionVersionTable'
    ),
  ]);
  const preKeyId =
    toPositiveInteger(metaMap.signal_prekey_id) ??
    toPositiveInteger(metaMap.signal_pre_key_id) ??
    signedPreKey.keyId + 1;

  const dump: WhatsAppWebAuthDump = {
    _debug: isolatedWorldAuthExtractionDebug,
    appStateSyncKeyCount: syncKeyRows.length,
    appStateVersionCount: versionRows.length,
    creds: {
      account,
      advSecretKey: await getAdvSecretKeyBase64(),
      firstUnuploadedPreKeyId: preKeyId,
      me: {
        id: meId,
        ...(meLid ? { lid: meLid } : {}),
        ...(meDisplayName ? { name: meDisplayName } : {}),
      },
      nextPreKeyId: preKeyId,
      noiseKey: {
        private: bytesToBase64Required(noise.private, 'noise private key'),
        public: bytesToBase64Required(noise.public, 'noise public key'),
      },
      platform: 'web',
      registrationId,
      signedIdentityKey: {
        private: bytesToBase64Required(
          staticPrivateKey,
          'identity private key'
        ),
        public: bytesToBase64Required(staticPublicKey, 'identity public key'),
      },
      signedPreKey,
    },
  };

  recordDebugLog('secure_session.auth_dump.isolated_world.done', {
    debug: isolatedWorldAuthExtractionDebug,
    has_noise: true,
  });

  return dump;
}

function throwAuthExtractionError(message: string): never {
  recordDebugLog('secure_session.auth_dump.isolated_world.error', {
    debug: isolatedWorldAuthExtractionDebug,
    reason: message,
  });
  throw new Error(message);
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

async function listIndexedDbNames(): Promise<string[]> {
  return typeof indexedDB.databases === 'function'
    ? indexedDB
        .databases()
        .then((databases) =>
          databases
            .map((database) => database.name)
            .filter((name): name is string => Boolean(name))
        )
        .catch(() => [])
    : [];
}

function openIndexedDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error(`indexeddb_open_failed:${name}`));
  });
}

function getAllFromIndexedDbStore(
  database: IDBDatabase,
  storeName: string
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();

      request.onsuccess = () =>
        resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () =>
        reject(
          request.error ?? new Error(`indexeddb_get_all_failed:${storeName}`)
        );
    } catch (error) {
      reject(error);
    }
  });
}

function createSignalMetaMap(rows: unknown[]): JsonRecord {
  const metaMap: JsonRecord = {};

  rows.forEach((row) => {
    if (!isRecord(row)) {
      return;
    }

    const key = normalizeOptionalString(row.key);
    if (!key) {
      return;
    }

    metaMap[key] = row.value;
  });

  return metaMap;
}

async function decryptRegistrationMaterial(
  value: unknown
): Promise<Uint8Array | null> {
  if (!isRecord(value)) {
    return null;
  }

  const encrypted = toUint8(value.value);
  if (!value.encKey || !encrypted) {
    return null;
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      counter: new Uint8Array(16),
      length: 128,
      name: 'AES-CTR',
    },
    value.encKey as CryptoKey,
    new Uint8Array(encrypted)
  );

  return new Uint8Array(decrypted);
}

function getWaModule(name: string): unknown {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const directRequire = globalRecord.require;

  try {
    if (typeof directRequire === 'function') {
      return unwrapModule(
        (directRequire as (moduleName: string) => unknown)(name)
      );
    }
  } catch {}

  const moduleLoader = globalRecord.__d;
  if (typeof moduleLoader !== 'function') {
    return null;
  }

  try {
    let captured: unknown;
    const sentinel = `__underchatWaProbe_${Math.random()
      .toString(36)
      .slice(2)}`;
    (
      moduleLoader as (
        id: string,
        deps: string[],
        factory: (...args: unknown[]) => void
      ) => void
    )(sentinel, [name], (...args: unknown[]) => {
      const parentRequire = args[3];
      if (typeof parentRequire === 'function') {
        captured = unwrapModule(
          (parentRequire as (moduleName: string) => unknown)(name)
        );
      }
    });

    const loaderRequire = (moduleLoader as unknown as Record<string, unknown>)
      .require;
    if (!captured && typeof loaderRequire === 'function') {
      captured = unwrapModule(
        (loaderRequire as (moduleName: string) => unknown)(name)
      );
    }

    return captured ?? null;
  } catch {
    return null;
  }
}

function unwrapModule(value: unknown): unknown {
  return isRecord(value) && value.default ? value.default : value;
}

async function getRegistrationInfoViaInternalModule(): Promise<unknown> {
  const module = getWaModule('WAWebSignalStoreApi');
  const signalStore = isRecord(module) ? module.waSignalStore : null;
  const getter = isRecord(signalStore) ? signalStore.getRegistrationInfo : null;

  if (typeof getter !== 'function') {
    return null;
  }

  try {
    return await (getter as () => Promise<unknown>)();
  } catch {
    return null;
  }
}

async function getNoiseInfoViaInternalModule(): Promise<{
  private: Uint8Array;
  public: Uint8Array;
} | null> {
  const module = getWaModule('WAWebUserPrefsInfoStore');
  pushAuthExtractionDebug('noise.module.lookup', {
    module_keys: summarizeRecordKeys(module),
    module_present: isRecord(module),
  });

  const containers: Array<{ label: string; value: JsonRecord }> = [];
  if (isRecord(module)) {
    containers.push({ label: 'module', value: module });
    if (isRecord(module.waNoiseInfo)) {
      containers.push({
        label: 'module.waNoiseInfo',
        value: module.waNoiseInfo,
      });
    }
    if (isRecord(module.default)) {
      containers.push({ label: 'module.default', value: module.default });
    }
    if (isRecord(module.default) && isRecord(module.default.waNoiseInfo)) {
      containers.push({
        label: 'module.default.waNoiseInfo',
        value: module.default.waNoiseInfo,
      });
    }
  }

  for (const candidate of containers) {
    const container = candidate.value;
    pushAuthExtractionDebug('noise.container.inspect', {
      keys: summarizeRecordKeys(container),
      label: candidate.label,
    });

    const directPair = normalizeNoiseKeyPair(container);
    if (directPair) {
      pushAuthExtractionDebug('noise.source.selected', {
        pair: summarizeBytePair(directPair),
        source: candidate.label,
      });
      return directPair;
    }

    for (const field of ['noiseInfo', 'staticKeyPair', 'keyPair', 'value']) {
      const fieldPair = normalizeNoiseKeyPair(container[field]);
      if (fieldPair) {
        pushAuthExtractionDebug('noise.source.selected', {
          pair: summarizeBytePair(fieldPair),
          source: `${candidate.label}.${field}`,
        });
        return fieldPair;
      }
    }

    for (const methodName of [
      'getUnlockedNoiseInfo',
      'getNoiseInfo',
      'get',
      'getNoiseInfoStore',
    ]) {
      const getter = container[methodName];
      if (typeof getter !== 'function') {
        pushAuthExtractionDebug('noise.method.missing', {
          container: candidate.label,
          method: methodName,
        });
        continue;
      }

      try {
        const value = await (getter as () => Promise<unknown>).call(container);
        const pair = normalizeNoiseKeyPair(value);
        pushAuthExtractionDebug('noise.method.result', {
          container: candidate.label,
          method: methodName,
          pair: summarizeBytePair(pair),
          value_keys: summarizeRecordKeys(value),
        });
        if (pair) {
          return pair;
        }
      } catch (error) {
        pushAuthExtractionDebug('noise.method.error', {
          container: candidate.label,
          method: methodName,
          reason: sanitizeOverlayError(error),
        });
      }
    }
  }

  return getNoiseInfoFromLocalStorage();
}

function normalizeNoiseKeyPair(value: unknown): {
  private: Uint8Array;
  public: Uint8Array;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidates = [
    value,
    value.staticKeyPair,
    value.keyPair,
    value.noiseKey,
    value.noiseInfo,
    value.value,
    value.data,
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const publicKey = toUint8FromPaths(candidate, [
      ['pubKey'],
      ['publicKey'],
      ['public'],
      ['pub'],
    ]);
    const privateKey = toUint8FromPaths(candidate, [
      ['privKey'],
      ['privateKey'],
      ['private'],
      ['priv'],
    ]);

    if (publicKey && privateKey) {
      pushAuthExtractionDebug('noise.pair.candidate', {
        pair: summarizeBytePair({
          private: privateKey,
          public: publicKey,
        }),
      });
      if (!isPlausibleNoiseKeyPair(privateKey, publicKey)) {
        continue;
      }

      return {
        private: privateKey,
        public: publicKey,
      };
    }
  }

  return null;
}

function isPlausibleNoiseKeyPair(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return privateKey.length === 32 && [32, 33].includes(publicKey.length);
}

function getNoiseInfoFromLocalStorage(): {
  private: Uint8Array;
  public: Uint8Array;
} | null {
  for (const key of ['WANoiseInfo', 'NOISE_INFO', 'MD_NOISE_KEYS']) {
    const value = readLocalStorageJson(key);
    pushAuthExtractionDebug('noise.local_storage.inspect', {
      key,
      keys: summarizeRecordKeys(value),
      present: value !== null,
      type: Array.isArray(value) ? 'array' : typeof value,
    });

    const pair = normalizeNoiseKeyPair(value);
    if (pair) {
      pushAuthExtractionDebug('noise.source.selected', {
        pair: summarizeBytePair(pair),
        source: `localStorage.${key}`,
      });
      return pair;
    }
  }

  return null;
}

async function getAdvSecretKeyBase64(): Promise<string | null> {
  const module = getWaModule('WAWebUserPrefsMultiDevice');
  const getter = isRecord(module) ? module.getADVSecretKey : null;

  if (typeof getter !== 'function') {
    return null;
  }

  try {
    const value = await (getter as () => Promise<unknown>)();
    if (typeof value === 'string') {
      return value;
    }

    return bytesToBase64(value);
  } catch {
    return null;
  }
}

async function getModelTableRows(
  moduleName: string,
  tableGetterName: string
): Promise<unknown[]> {
  const module = getWaModule(moduleName);
  const getter = isRecord(module) ? module[tableGetterName] : null;

  if (typeof getter !== 'function') {
    return [];
  }

  try {
    const table = (getter as () => unknown)();
    const all = isRecord(table) ? table.all : null;
    if (typeof all !== 'function') {
      return [];
    }

    const rows = await (all as () => Promise<unknown>)();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function getLatestSignedPreKey(
  rows: unknown[]
): WhatsAppWebExtractedCreds['signedPreKey'] | null {
  const candidates = rows
    .filter(isRecord)
    .map((row) => {
      const keyPair = isRecord(row.keyPair) ? row.keyPair : null;
      const keyId = toPositiveInteger(row.keyId);
      const publicKey = keyPair ? toUint8(keyPair.pubKey) : null;
      const privateKey = keyPair ? toUint8(keyPair.privKey) : null;
      const signature = toUint8(row.signature);

      if (!keyId || !publicKey || !privateKey || !signature) {
        return null;
      }

      return {
        keyId,
        keyPair: {
          private: bytesToBase64Required(privateKey, 'signed pre-key private'),
          public: bytesToBase64Required(publicKey, 'signed pre-key public'),
        },
        signature: bytesToBase64Required(signature, 'signed pre-key signature'),
      };
    })
    .filter(
      (candidate): candidate is WhatsAppWebExtractedCreds['signedPreKey'] =>
        Boolean(candidate)
    )
    .sort((left, right) => left.keyId - right.keyId);

  return candidates.at(-1) ?? null;
}

function extractAdvAccount(
  value: unknown
): WhatsAppWebExtractedCreds['account'] | null {
  if (!isRecord(value)) {
    return null;
  }

  const accountSignature = bytesToBase64(value.accountSignature);
  const accountSignatureKey = bytesToBase64(value.accountSignatureKey);
  const details = bytesToBase64(value.details);
  const deviceSignature = bytesToBase64(value.deviceSignature);

  if (
    !accountSignature ||
    !accountSignatureKey ||
    !details ||
    !deviceSignature
  ) {
    return null;
  }

  return {
    accountSignature,
    accountSignatureKey,
    details,
    deviceSignature,
  };
}

function readLocalStorageJson(key: string): unknown {
  const value = localStorage.getItem(key);

  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function widToJid(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const wid = value.trim();
  const atIndex = wid.lastIndexOf('@');
  const head = atIndex >= 0 ? wid.slice(0, atIndex) : wid;
  const server = atIndex >= 0 ? wid.slice(atIndex + 1) : 's.whatsapp.net';
  const colonIndex = head.indexOf(':');
  const userAndAgent = colonIndex >= 0 ? head.slice(0, colonIndex) : head;
  const device = colonIndex >= 0 ? Number(head.slice(colonIndex + 1)) : 0;
  const dotIndex = userAndAgent.indexOf('.');
  const user = dotIndex >= 0 ? userAndAgent.slice(0, dotIndex) : userAndAgent;

  if (!user || !Number.isFinite(device)) {
    return null;
  }

  return `${user}:${device}@${server}`;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function toUint8FromPath(value: unknown, path: string[]): Uint8Array | null {
  let current = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[key];
  }

  return toUint8(current);
}

function toUint8FromPaths(
  value: unknown,
  paths: string[][]
): Uint8Array | null {
  for (const path of paths) {
    const bytes = toUint8FromPath(value, path);
    if (bytes) {
      return bytes;
    }
  }

  return null;
}

function toUint8(value: unknown): Uint8Array | null {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string') {
    const base64Bytes = base64ToBytes(value);
    if (base64Bytes) {
      return base64Bytes;
    }
    return Uint8Array.from(value, (char) => char.charCodeAt(0));
  }
  if (
    isRecord(value) &&
    value.type === 'Buffer' &&
    typeof value.data === 'string'
  ) {
    return base64ToBytes(value.data);
  }

  return null;
}

function bytesToBase64(value: unknown): string | null {
  const bytes = toUint8(value);
  if (!bytes) {
    return null;
  }

  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }

  return btoa(binary);
}

function bytesToBase64Required(value: unknown, label: string): string {
  const base64 = bytesToBase64(value);
  if (!base64) {
    throw new Error(`Nao foi possivel converter ${label} para base64.`);
  }

  return base64;
}

function base64ToBytes(value: string): Uint8Array | null {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
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

function toPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getSecureSessionTargetProvider(): SecureSessionPackage['target_provider'] {
  const workerTypeId = state.helperPayload?.session?.worker_type_id;
  if (!workerTypeId) {
    return 'auto';
  }

  return WORKER_TYPE_PROVIDER_MAP[workerTypeId] ?? 'auto';
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
  if (automaticExtractionRetryTimerId !== null) {
    window.clearTimeout(automaticExtractionRetryTimerId);
    automaticExtractionRetryTimerId = null;
  }
  stopSecureUploadStatusPolling();
  if (helperAutoCloseTimerId !== null) {
    window.clearTimeout(helperAutoCloseTimerId);
    helperAutoCloseTimerId = null;
  }

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
