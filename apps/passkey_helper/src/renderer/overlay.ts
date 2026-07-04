import type {
  PasskeyHelperActionResult,
  PasskeyHelperSessionPayload,
  UnderchatPasskeyBridge,
} from '../preload';
import overlayCss from './overlay.css?inline';

interface OverlayState {
  busy: boolean;
  connected: boolean;
  error: string | null;
  helperPayload: PasskeyHelperSessionPayload | null;
  message: string | null;
}

const CONNECTED_CODES = new Set([200, 201]);
const CONFIRMATION_CODES = new Set([208]);

let bridgeRef: UnderchatPasskeyBridge | null = null;
let rootElement: HTMLElement | null = null;
let state: OverlayState = {
  busy: false,
  connected: false,
  error: null,
  helperPayload: null,
  message: null,
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
  } catch (error) {
    setState({
      busy: false,
      error: sanitizeOverlayError(error),
      message: null,
    });
  }
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
  const code = result.status ?? result.code;

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
          <span>API: ${escapeHtml(formatApi(payload?.apiBaseUrl))}</span>
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

function formatApi(apiBaseUrl?: string): string {
  if (!apiBaseUrl) {
    return 'nao informada';
  }

  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return 'invalida';
  }
}

function sanitizeOverlayError(error: unknown): string {
  if (error instanceof Error && error.message) {
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
