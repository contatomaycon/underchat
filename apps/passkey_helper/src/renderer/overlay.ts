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

let bridgeRef: UnderchatPasskeyBridge | null = null;
let rootElement: HTMLElement | null = null;
let readinessIntervalId: number | null = null;
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
    refreshSession();
  });
}

async function refreshSession(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  setState({
    busy: true,
    error: null,
    message: 'Buscando dados da verificacao...',
  });

  try {
    const helperPayload = await bridgeRef.getSession();

    setState({
      busy: false,
      error: helperPayload.error ?? null,
      helperPayload,
      message: null,
    });

    if (helperPayload.mode === 'secure') {
      await bridgeRef.updateSecureStatus({
        status: 'helper_opened',
      });
      startWhatsappReadinessProbe();
    }
  } catch (error) {
    setState({
      busy: false,
      error: sanitizeOverlayError(error),
      message: null,
    });
  }
}

function startWhatsappReadinessProbe(): void {
  if (readinessIntervalId !== null) {
    window.clearInterval(readinessIntervalId);
  }

  const probe = (): void => {
    const ready = detectWhatsAppAuthenticated();
    if (ready !== state.whatsappReady) {
      setState({ whatsappReady: ready });
      if (ready && bridgeRef) {
        void bridgeRef.updateSecureStatus({
          status: 'wa_authenticated',
        });
      }
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
        ? 'Sessao detectada. Clique em Conectar a Underchat para enviar a sessao ao canal.'
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
            state.busy || !state.whatsappReady || terminal ? 'disabled' : ''
          }>Conectar a Underchat</button>
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
      connectSecureSessionToUnderchat();
    });
  rootElement
    .querySelector('[data-action="refresh"]')
    ?.addEventListener('click', () => {
      refreshSession();
    });
}

async function connectSecureSessionToUnderchat(): Promise<void> {
  if (!bridgeRef) {
    return;
  }

  if (!detectWhatsAppAuthenticated()) {
    setState({
      error: 'O WhatsApp Web ainda nao parece autenticado nesta janela.',
      message: null,
      whatsappReady: false,
    });
    return;
  }

  setState({
    busy: true,
    error: null,
    message: 'Preparando pacote da sessao autenticada...',
  });

  try {
    await bridgeRef.updateSecureStatus({ status: 'uploading' });
    const sessionPackage = await collectSecureSessionPackage();
    const result = await bridgeRef.sendSecureSessionPackage(sessionPackage);

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
  }
}

function detectWhatsAppAuthenticated(): boolean {
  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    return false;
  }

  const selectors = [
    '[data-testid="chat-list"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[aria-label="Chat list"]',
    '[aria-label="Lista de conversas"]',
    '[contenteditable="true"][role="textbox"]',
  ];

  if (selectors.some((selector) => document.querySelector(selector))) {
    return true;
  }

  try {
    return Object.keys(localStorage).some((key) =>
      /wa|wawc|whatsapp|last-wid|multi-device/i.test(key)
    );
  } catch {
    return false;
  }
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
