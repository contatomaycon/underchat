import './popup.css';

import type {
  PopupConnectionState,
  PopupStepId,
  PopupStepState,
  PopupStepStatus,
} from './types';
import {
  readWhatsAppReadiness,
  type WhatsAppReadinessSnapshot,
} from './pageScripts';

const POPUP_STATE_KEY = 'underchat_connection_state';
const POPUP_TOKEN_KEY = 'underchat_connection_token';
const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const STEP_IDS: PopupStepId[] = [
  'whatsapp_open',
  'whatsapp_connected',
  'token_pasted',
  'session_imported',
  'local_cleanup',
];
const CLEANUP_WATCHDOG_INTERVAL_MS = 1_000;
const CLEANUP_WATCHDOG_REQUIRED_SAMPLES = 2;

const tokenForm = document.querySelector<HTMLFormElement>('#token-form');
const tokenInput = document.querySelector<HTMLTextAreaElement>('#token-input');
const actionRow = document.querySelector<HTMLElement>('#action-row');
const connectButton =
  document.querySelector<HTMLButtonElement>('#connect-button');
const cancelButton =
  document.querySelector<HTMLButtonElement>('#cancel-button');
const tabState = document.querySelector<HTMLElement>('#tab-state');
const tabStateLabel = document.querySelector<HTMLElement>('#tab-state-label');
const statusCard = document.querySelector<HTMLElement>('#status-card');
const statusTitle = document.querySelector<HTMLElement>('#status-title');
const statusMessage = document.querySelector<HTMLElement>('#status-message');

let activeTab: ChromeTab | null = null;
let isBusy = false;
let currentSteps = createDefaultSteps();
let cleanupWatchdogInterval: number | null = null;
let cleanupLoggedOutSamples = 0;

void initializePopup();

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'underchat:connection_state') {
    return false;
  }

  if (isPopupState(message.payload)) {
    applyConnectionState(message.payload);
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  const tokenChange = changes[POPUP_TOKEN_KEY];
  const nextToken = normalizeToken(tokenChange?.newValue);
  const tokenWasCleared = Boolean(tokenChange) && !nextToken;
  if (tokenInput && tokenChange) {
    tokenInput.value = nextToken;
  }

  const nextState = changes[POPUP_STATE_KEY]?.newValue;
  if (isPopupState(nextState) && !tokenWasCleared) {
    applyConnectionState(nextState);
  }

  if (tokenWasCleared) {
    resetToInitialState();
    return;
  }

  if (tokenChange) {
    renderTokenStep();
  }
});

tokenForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void startConnection();
});

tokenInput?.addEventListener('input', () => {
  void persistCurrentToken();
  if (tokenInput.value.trim()) {
    renderTokenStep();
    return;
  }

  resetToInitialState();
});

cancelButton?.addEventListener('click', () => {
  void cancelConnection();
});

async function initializePopup() {
  activeTab = await getActiveTab();
  renderTabState();

  const stored = await chrome.storage.local.get<{
    [POPUP_STATE_KEY]?: PopupConnectionState;
    [POPUP_TOKEN_KEY]?: string;
  }>([POPUP_STATE_KEY, POPUP_TOKEN_KEY]);
  const storedToken = normalizeToken(stored[POPUP_TOKEN_KEY]);

  if (tokenInput) {
    tokenInput.value = storedToken;
  }

  const state = stored[POPUP_STATE_KEY];
  if (storedToken && isPopupState(state)) {
    applyConnectionState(state);
  } else {
    if (!storedToken && state) {
      void chrome.storage.local.remove(POPUP_STATE_KEY);
    }
    applyConnectionState(createInitialConnectionState());
  }

  renderTokenStep();
  void refreshWhatsAppReadinessStep();
  tokenInput?.focus();
}

async function startConnection() {
  const token = tokenInput?.value.trim() ?? '';

  if (!activeTab?.id || !isWhatsAppWebUrl(activeTab.url ?? '')) {
    applyConnectionState({
      busy: false,
      message:
        'Abra web.whatsapp.com em uma aba autenticada e tente novamente.',
      tabReady: false,
      title: 'Aba inválida',
      tone: 'error',
    });
    return;
  }

  if (!token) {
    applyConnectionState({
      busy: false,
      message: 'Cole o token gerado na tela de conexão da Underchat.',
      tabReady: true,
      title: 'Token obrigatório',
      tone: 'error',
    });
    return;
  }

  await persistConnectionToken(token);
  applyConnectionState({
    busy: true,
    message: 'Iniciando conexão segura com a Underchat.',
    tabReady: true,
    title: 'Conectando',
    tone: 'busy',
  });

  const response = await chrome.runtime.sendMessage<{
    error?: string;
    ok: boolean;
  }>({
    payload: {
      tabId: activeTab.id,
      tabUrl: activeTab.url ?? '',
      token,
    },
    type: 'underchat:start_connection',
  });

  if (!response?.ok) {
    applyConnectionState({
      busy: false,
      message:
        response?.error === 'connection_in_progress'
          ? 'Já existe uma conexão em andamento nesta extensão.'
          : response?.error === 'handoff_recovery_pending'
            ? 'Existe uma transferência anterior em recuperação. Aguarde a restauração das abas antes de iniciar outra.'
            : response?.error || 'Não foi possível iniciar a conexão.',
      tabReady: true,
      title: 'Não foi possível conectar',
      tone: 'error',
    });
  }
}

async function cancelConnection() {
  if (cancelButton) {
    cancelButton.disabled = true;
    cancelButton.textContent = 'Cancelando...';
  }

  const response = await chrome.runtime
    .sendMessage<{ error?: string; ok: boolean; pending?: boolean }>({
      payload: {
        token: tokenInput?.value.trim() ?? '',
      },
      type: 'underchat:cancel_connection',
    })
    .catch(() => ({ ok: false, error: 'Falha ao solicitar cancelamento.' }));

  if (!response.ok) {
    applyConnectionState({
      busy: false,
      message: response.error ?? 'Não foi possível cancelar a conexão.',
      tabReady: false,
      title: 'Falha ao cancelar',
      tone: 'error',
    });
  }

  if (cancelButton) {
    cancelButton.disabled = false;
    cancelButton.textContent = 'Cancelar';
  }
}

async function persistCurrentToken(): Promise<void> {
  const token = tokenInput?.value.trim() ?? '';
  if (token) {
    await persistConnectionToken(token);
    return;
  }

  await clearPersistedToken();
}

async function persistConnectionToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [POPUP_TOKEN_KEY]: token });
}

async function clearPersistedToken(): Promise<void> {
  await chrome.storage.local.remove([POPUP_TOKEN_KEY, POPUP_STATE_KEY]);
  if (tokenInput) {
    tokenInput.value = '';
  }
}

function resetToInitialState() {
  applyConnectionState(createInitialConnectionState());
  void refreshWhatsAppReadinessStep();
}

async function getActiveTab(): Promise<ChromeTab | null> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tabs[0] ?? null;
}

function renderTabState() {
  const ready = Boolean(activeTab?.id && isWhatsAppWebUrl(activeTab.url ?? ''));
  if (tabState) {
    tabState.dataset.tone = ready ? 'ready' : 'error';
  }
  if (tabStateLabel) {
    tabStateLabel.textContent = ready
      ? 'Aba do WhatsApp Web detectada'
      : 'Abra uma aba do WhatsApp Web';
  }
  if (connectButton) {
    connectButton.disabled = isBusy || !ready;
  }
  const current = currentSteps.find((step) => step.id === 'whatsapp_open');
  if (current?.status !== 'done') {
    setStepStatus('whatsapp_open', ready ? 'done' : 'pending');
  }

  if (!ready) {
    const connectionStep = currentSteps.find(
      (step) => step.id === 'whatsapp_connected'
    );
    if (connectionStep?.status !== 'done') {
      setStepStatus('whatsapp_connected', 'pending');
    }
  }
}

function renderTokenStep() {
  setStepStatus('token_pasted', tokenInput?.value.trim() ? 'done' : 'pending');
}

async function refreshWhatsAppReadinessStep() {
  if (!activeTab?.id || !isWhatsAppWebUrl(activeTab.url ?? '')) {
    return;
  }

  try {
    const readiness = await executeInMainWorld(
      activeTab.id,
      readWhatsAppReadiness
    );
    setStepStatus('whatsapp_open', 'done');
    setStepStatus(
      'whatsapp_connected',
      readiness.authenticated ? 'done' : 'active'
    );
    renderPassiveReadinessStatus(readiness);
  } catch {
    setStepStatus('whatsapp_open', 'done');
    setStepStatus('whatsapp_connected', 'active');
  }
}

function renderPassiveReadinessStatus(readiness: WhatsAppReadinessSnapshot) {
  if (isBusy) {
    return;
  }

  if (!readiness.authenticated) {
    renderStatusCard({
      message:
        'Escaneie o QR code ou entre com o número de telefone para conectar o WhatsApp Web.',
      title: 'Conecte o WhatsApp',
      tone: 'waiting',
    });
    return;
  }

  if (readiness.syncing) {
    renderStatusCard({
      message:
        'WhatsApp Web conectado. Aguarde as mensagens terminarem de carregar.',
      title: 'Carregando mensagens',
      tone: 'waiting',
    });
    return;
  }

  renderStatusCard({
    message:
      'WhatsApp Web conectado. Cole o token do canal e inicie a conexão.',
    title: 'Aguardando token',
    tone: 'waiting',
  });
}

function applyConnectionState(state: PopupConnectionState) {
  isBusy = state.busy;
  currentSteps = normalizeSteps(state.steps);
  if (actionRow) {
    actionRow.dataset.busy = String(state.busy);
  }
  if (statusCard) {
    statusCard.dataset.busy = String(state.busy);
    statusCard.dataset.tone = state.tone;
  }
  if (statusTitle) {
    statusTitle.textContent = state.title;
  }
  if (statusMessage) {
    statusMessage.textContent = state.message;
  }
  if (tokenInput) {
    tokenInput.readOnly = state.busy;
    tokenInput.setAttribute('aria-disabled', String(state.busy));
  }
  if (connectButton) {
    connectButton.disabled =
      state.busy ||
      !Boolean(activeTab?.id && isWhatsAppWebUrl(activeTab.url ?? ''));
    connectButton.textContent = state.busy
      ? 'Conectando...'
      : 'Conectar à Underchat';
  }
  if (cancelButton) {
    cancelButton.hidden = !state.busy;
    cancelButton.disabled = false;
    cancelButton.textContent = 'Cancelar';
  }
  renderSteps();
  renderTabState();
  renderTokenStep();

  if (!state.busy && state.tone === 'success') {
    void clearPersistedToken();
  }

  syncCleanupWatchdog(state);
}

function renderStatusCard(input: {
  message: string;
  title: string;
  tone: PopupConnectionState['tone'];
}) {
  if (statusCard) {
    statusCard.dataset.busy = 'false';
    statusCard.dataset.tone = input.tone;
  }
  if (statusTitle) {
    statusTitle.textContent = input.title;
  }
  if (statusMessage) {
    statusMessage.textContent = input.message;
  }
}

function createInitialConnectionState(): PopupConnectionState {
  return {
    busy: false,
    message:
      'Abra uma aba do WhatsApp Web autenticada, cole o token do canal e inicie a conexão.',
    steps: createDefaultSteps(),
    tabReady: Boolean(activeTab?.id && isWhatsAppWebUrl(activeTab.url ?? '')),
    title: 'Aguardando token',
    tone: 'waiting',
  };
}

function syncCleanupWatchdog(state: PopupConnectionState) {
  const localCleanupStep = currentSteps.find(
    (step) => step.id === 'local_cleanup'
  );
  const shouldWatch =
    state.busy && localCleanupStep?.status === 'active' && Boolean(tokenInput);

  if (!shouldWatch) {
    stopCleanupWatchdog();
    return;
  }

  startCleanupWatchdog();
}

function startCleanupWatchdog() {
  if (cleanupWatchdogInterval !== null) {
    return;
  }

  cleanupLoggedOutSamples = 0;
  cleanupWatchdogInterval = window.setInterval(() => {
    void checkObservedLocalCleanup();
  }, CLEANUP_WATCHDOG_INTERVAL_MS);
  void checkObservedLocalCleanup();
}

function stopCleanupWatchdog() {
  if (cleanupWatchdogInterval === null) {
    return;
  }

  window.clearInterval(cleanupWatchdogInterval);
  cleanupWatchdogInterval = null;
  cleanupLoggedOutSamples = 0;
}

async function checkObservedLocalCleanup() {
  const localCleanupStep = currentSteps.find(
    (step) => step.id === 'local_cleanup'
  );
  if (!isBusy || localCleanupStep?.status !== 'active') {
    stopCleanupWatchdog();
    return;
  }

  activeTab = await getActiveTab();
  if (!activeTab?.id || !isWhatsAppWebUrl(activeTab.url ?? '')) {
    cleanupLoggedOutSamples = 0;
    return;
  }

  try {
    const readiness = await executeInMainWorld(
      activeTab.id,
      readWhatsAppReadiness
    );
    if (!readiness.authenticated && readiness.hasBlockingLoginUi) {
      cleanupLoggedOutSamples += 1;
    } else {
      cleanupLoggedOutSamples = 0;
    }

    if (cleanupLoggedOutSamples >= CLEANUP_WATCHDOG_REQUIRED_SAMPLES) {
      await completeObservedLocalCleanup();
    }
  } catch {
    cleanupLoggedOutSamples = 0;
  }
}

async function completeObservedLocalCleanup() {
  stopCleanupWatchdog();
  await chrome.runtime
    .sendMessage<{ ok: boolean }>({
      payload: {
        token: tokenInput?.value.trim() ?? '',
      },
      type: 'underchat:local_cleanup_completed',
    })
    .catch(() => ({ ok: false }));

  await clearPersistedToken();
  applyConnectionState(createInitialConnectionState());
  void refreshWhatsAppReadinessStep();
}

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isWhatsAppWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === WHATSAPP_WEB_ORIGIN;
  } catch {
    return false;
  }
}

async function executeInMainWorld<T>(
  tabId: number,
  func: () => T | Promise<T>
): Promise<Awaited<T>> {
  const [injection] = await chrome.scripting.executeScript({
    func,
    target: { tabId },
    world: 'MAIN',
  });

  if (!injection || injection.result === undefined) {
    throw new Error('Não foi possível acessar a aba do WhatsApp Web.');
  }

  return injection.result as Awaited<T>;
}

function isPopupState(value: unknown): value is PopupConnectionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.busy === 'boolean' &&
    typeof record.message === 'string' &&
    typeof record.tabReady === 'boolean' &&
    typeof record.title === 'string' &&
    typeof record.tone === 'string' &&
    (record.steps === undefined || isPopupSteps(record.steps))
  );
}

function createDefaultSteps(): PopupStepState[] {
  return STEP_IDS.map((id) => ({ id, status: 'pending' }));
}

function normalizeSteps(value: PopupStepState[] | undefined): PopupStepState[] {
  if (!value) {
    return currentSteps.length ? currentSteps : createDefaultSteps();
  }

  const byId = new Map(value.map((step) => [step.id, step.status]));
  return STEP_IDS.map((id) => ({
    id,
    status: byId.get(id) ?? 'pending',
  }));
}

function setStepStatus(id: PopupStepId, status: PopupStepStatus) {
  currentSteps = currentSteps.map((step) =>
    step.id === id ? { ...step, status } : step
  );
  renderSteps();
}

function renderSteps() {
  for (const step of currentSteps) {
    const element = document.querySelector<HTMLElement>(
      `.step[data-step-id="${step.id}"]`
    );
    const marker = element?.querySelector<HTMLElement>('.step-marker');
    if (!element || !marker) {
      continue;
    }

    element.dataset.status = step.status;
    if (step.status === 'done') {
      marker.textContent = '✓';
      continue;
    }
    if (step.status === 'error') {
      marker.textContent = '!';
      continue;
    }
    marker.textContent = String(STEP_IDS.indexOf(step.id) + 1);
  }
}

function isPopupSteps(value: unknown): value is PopupStepState[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }
      const record = item as Record<string, unknown>;
      return (
        STEP_IDS.includes(record.id as PopupStepId) &&
        ['active', 'done', 'error', 'pending'].includes(
          record.status as PopupStepStatus
        )
      );
    })
  );
}
