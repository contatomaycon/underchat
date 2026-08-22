import {
  fetchSecureSession,
  updateSecureStatus,
  uploadSecureSession,
} from './apiClient';
import {
  buildSecureSessionPackage,
  targetProviderForWorkerType,
  type WwebjsCanonicalProjection,
} from './sessionPackage';
import { exportCanonicalSessionProjection } from '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js';
import type {
  SecureConnectionSessionResponse,
  SecureConnectionStatus,
  PopupConnectionState,
  PopupStepId,
  PopupStepState,
  PopupStepStatus,
} from './types';
import {
  extractWhatsAppWebAuthDump,
  readWhatsAppPageContext,
  readWhatsAppReadiness,
  type WhatsAppReadinessSnapshot,
} from './pageScripts';

const POPUP_STATE_KEY = 'underchat_connection_state';
const POPUP_TOKEN_KEY = 'underchat_connection_token';
const HANDOFF_LEASE_KEY = 'underchat_whatsapp_handoff_lease';
const HANDOFF_RECOVERY_ALARM = 'underchat_whatsapp_handoff_recovery';
const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const WHATSAPP_WEB_URL_PATTERN = `${WHATSAPP_WEB_ORIGIN}/*`;
const HOLDING_PAGE_PATH = 'holding.html';
const HANDOFF_TIMEOUT_MS = 10 * 60_000;
const HANDOFF_POLL_MS = 2_000;
const IMPORT_CONFIRM_TIMEOUT_MS = 180_000;
const IMPORT_CONFIRM_POLL_MS = 3_000;
const CLEANUP_VERIFY_TIMEOUT_MS = 30_000;
const CLEANUP_VERIFY_POLL_MS = 1_000;
const CLEANUP_OPERATION_TIMEOUT_MS = 15_000;
const CLEANUP_PAGE_CONTEXT_TIMEOUT_MS = 4_000;
const CLEANUP_REQUIRED_STABLE_SAMPLES = 2;
const CLEANUP_TOTAL_TIMEOUT_MS = 45_000;
const HANDOFF_RECOVERY_DELAY_MS = 5_000;
const WWEBJS_CANONICAL_MAX_BYTES = 64 * 1024 * 1024;
const WWEBJS_CANONICAL_MAX_RECORDS = 200_000;
const STEP_IDS: PopupStepId[] = [
  'whatsapp_open',
  'whatsapp_connected',
  'token_pasted',
  'session_imported',
  'local_cleanup',
];
const TERMINAL_STATUSES = new Set<SecureConnectionStatus>([
  'connected_confirmed',
  'failed',
  'expired',
  'cancelled',
]);

type ConnectionRun = {
  abortController: AbortController;
  cancelled: boolean;
  handoffLease: WhatsAppHandoffLease | null;
  settled: Promise<void> | null;
  token: string;
  uploadStarted: boolean;
};

type HandoffLeasePhase =
  | 'quiescing'
  | 'quiesced'
  | 'cleanup_committing'
  | 'origin_cleared'
  | 'restoring';

type WhatsAppHandoffTab = {
  tabId: number;
  url: string;
};

type WhatsAppHandoffLease = {
  connectionAttemptId: string;
  createdAt: string;
  phase: HandoffLeasePhase;
  runtimeGeneration?: number;
  sourceTabId: number;
  tabs: WhatsAppHandoffTab[];
  tokenHash: string;
  uploadStarted: boolean;
  version: 1;
};

class ConfirmedTerminalConnectionError extends Error {
  readonly session: SecureConnectionSessionResponse;

  constructor(session: SecureConnectionSessionResponse) {
    super(session.error || session.message || 'A importação da sessão falhou.');
    this.name = 'ConfirmedTerminalConnectionError';
    this.session = session;
  }
}

let activeRun: ConnectionRun | null = null;
let connectionStartInProgress = false;
let handoffRecoveryInProgress = false;
let handoffOriginGuardQueue = Promise.resolve();
let handoffTabGuardQueue = Promise.resolve();

void recoverPersistedHandoffLease().catch(() => undefined);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HANDOFF_RECOVERY_ALARM) {
    void recoverPersistedHandoffLease().catch(() => undefined);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab.url ?? '';
  if (!isWhatsAppWebUrl(url)) return;

  handoffTabGuardQueue = handoffTabGuardQueue
    .catch(() => undefined)
    .then(() => guardWhatsAppWebTabDuringHandoff(tabId, url))
    .catch(() => scheduleHandoffRecovery());
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'underchat:local_cleanup_completed') {
    const payload = isRecord(message.payload) ? message.payload : {};
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    void completeObservedLocalCleanup(token);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'underchat:cancel_connection') {
    const run = activeRun;
    const payload = isRecord(message.payload) ? message.payload : {};
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    void (run ? cancelConnection(run) : cancelStoredConnection(token))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: sanitizeError(error) })
      );
    return true;
  }

  if (message.type !== 'underchat:start_connection') {
    return false;
  }

  const payload = isRecord(message.payload) ? message.payload : {};
  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  const tabId = typeof payload.tabId === 'number' ? payload.tabId : null;
  const tabUrl = typeof payload.tabUrl === 'string' ? payload.tabUrl : '';

  if (activeRun || connectionStartInProgress) {
    sendResponse({ ok: false, error: 'connection_in_progress' });
    return false;
  }

  connectionStartInProgress = true;
  void beginConnection({ tabId, tabUrl, token })
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: sanitizeError(error) }))
    .finally(() => {
      connectionStartInProgress = false;
    });

  return true;
});

async function beginConnection(input: {
  tabId: number | null;
  tabUrl: string;
  token: string;
}): Promise<{ error?: string; ok: boolean }> {
  if (await readPersistedHandoffLease()) {
    await recoverPersistedHandoffLease();
    if (await readPersistedHandoffLease()) {
      return { error: 'handoff_recovery_pending', ok: false };
    }
  }

  if (activeRun) {
    return { error: 'connection_in_progress', ok: false };
  }

  const run: ConnectionRun = {
    abortController: new AbortController(),
    cancelled: false,
    handoffLease: null,
    settled: null,
    token: input.token,
    uploadStarted: false,
  };
  activeRun = run;
  const settled = startConnection(input, run)
    .catch(() => undefined)
    .finally(() => {
      if (activeRun === run) {
        activeRun = null;
      }
    });
  run.settled = settled;
  void settled;
  return { ok: true };
}

async function startConnection(
  input: {
    tabId: number | null;
    tabUrl: string;
    token: string;
  },
  run: ConnectionRun
) {
  if (!input.token) {
    throw new Error('Cole o token gerado na Underchat.');
  }

  if (!input.tabId || !isWhatsAppWebUrl(input.tabUrl)) {
    throw new Error('Abra uma aba do WhatsApp Web antes de conectar.');
  }

  await persistConnectionToken(input.token);
  await publishRunState(run, {
    busy: true,
    message: 'Validando token seguro na Underchat.',
    steps: buildSteps({
      token_pasted: 'done',
      whatsapp_connected: 'active',
      whatsapp_open: 'done',
    }),
    tabReady: true,
    title: 'Validando token',
    tone: 'busy',
  });

  let session: SecureConnectionSessionResponse | null = null;
  let whatsappReadyForHandoff = false;
  try {
    throwIfCancelled(run);
    session = await fetchSecureSession(input.token, run.abortController.signal);
    throwIfCancelled(run);
    const targetProvider = targetProviderForWorkerType(session.worker_type_id);

    await updateStatus(
      input.token,
      'helper_opened',
      {
        message: 'Extensão Google Chrome aberta no WhatsApp Web.',
      },
      run
    );
    await waitForHandoffReady(input.token, input.tabId, run);
    whatsappReadyForHandoff = true;
    throwIfCancelled(run);

    await publishRunState(run, {
      busy: true,
      message: 'Lendo dados locais do WhatsApp Web autenticado.',
      steps: buildSteps({
        token_pasted: 'done',
        whatsapp_connected: 'done',
        whatsapp_open: 'done',
      }),
      tabReady: true,
      title: 'Extraindo sessão',
      tone: 'busy',
    });

    const [pageContext, authDump] = await Promise.all([
      executeInMainWorld(input.tabId, readWhatsAppPageContext),
      executeInMainWorld(input.tabId, extractWhatsAppWebAuthDump),
    ]);
    throwIfCancelled(run);
    const wwebjsCanonicalProjection =
      targetProvider === 'wwebjs'
        ? await executeInMainWorld(
            input.tabId,
            exportCanonicalSessionProjection,
            {
              capturedAdvSecret: authDump.creds.advSecretKey,
              maxBytes: WWEBJS_CANONICAL_MAX_BYTES,
              maxRecords: WWEBJS_CANONICAL_MAX_RECORDS,
            }
          )
        : undefined;
    throwIfCancelled(run);
    const sessionPackage = buildSecureSessionPackage({
      authDump,
      pageContext,
      sourceClient: {
        kind: 'chrome_extension',
        version: __UNDERCHAT_EXTENSION_VERSION__,
      },
      targetProvider,
      wwebjsCanonicalProjection: wwebjsCanonicalProjection as
        WwebjsCanonicalProjection | undefined,
    });
    run.handoffLease = await quiesceWhatsAppWebTabs({
      run,
      session,
      sourceTabId: input.tabId,
    });
    throwIfCancelled(run);
    await enforceWhatsAppWebOriginGuard(run.handoffLease);
    throwIfCancelled(run);

    await updateStatus(
      input.token,
      'uploading',
      {
        message: 'Extensão enviando sessão autenticada para a Underchat.',
      },
      run
    );
    await publishRunState(run, {
      busy: true,
      message: 'Enviando sessão autenticada para a Underchat.',
      steps: buildSteps({
        session_imported: 'active',
        token_pasted: 'done',
        whatsapp_connected: 'done',
        whatsapp_open: 'done',
      }),
      tabReady: true,
      title: 'Enviando sessão',
      tone: 'busy',
    });

    if (!run.handoffLease) {
      throw new Error('whatsapp_handoff_lease_missing');
    }
    run.handoffLease.uploadStarted = true;
    await persistHandoffLease(run.handoffLease);
    run.uploadStarted = true;
    const uploadResult = await uploadSecureSession({
      signal: run.abortController.signal,
      sessionPackage,
      token: input.token,
    });
    const confirmed = await waitForConnectedConfirmation(
      input.token,
      uploadResult,
      run
    );
    throwIfCancelled(run);
    if (!run.handoffLease) {
      throw new Error('whatsapp_handoff_lease_missing');
    }
    await enforceWhatsAppWebOriginGuard(run.handoffLease);
    throwIfCancelled(run);

    await publishRunState(run, {
      busy: true,
      message: confirmed.phone
        ? `Sessão importada: ${confirmed.phone}. Limpando sessão local.`
        : 'Sessão importada. Limpando sessão local do WhatsApp Web.',
      steps: buildSteps({
        local_cleanup: 'active',
        session_imported: 'done',
        token_pasted: 'done',
        whatsapp_connected: 'done',
        whatsapp_open: 'done',
      }),
      tabReady: true,
      title: 'Limpando WhatsApp Web',
      tone: 'busy',
    });
    throwIfCancelled(run);
    const cleanupResult = await runCleanupWithFinalVerification(
      run.handoffLease
    );
    throwIfCancelled(run);

    if (cleanupResult.ok) {
      run.handoffLease = null;
      await publishRunState(run, createInitialState());
      await clearPersistedConnectionToken();
      return;
    }

    await publishRunState(run, createCleanupPendingState(cleanupResult.error));
    await scheduleHandoffRecovery().catch(() => undefined);
  } catch (error) {
    if (isCancellationError(error) || !isRunActive(run)) {
      return;
    }

    let message = sanitizeError(error);
    let terminalFailure =
      error instanceof ConfirmedTerminalConnectionError ? error.session : null;
    let localSessionRestored = false;
    let restoreAttempted = false;

    if (run.handoffLease && !run.uploadStarted) {
      restoreAttempted = true;
      const restoreResult = await restoreWhatsAppWebTabs(run.handoffLease);
      localSessionRestored = restoreResult.ok;
      if (restoreResult.ok) {
        run.handoffLease = null;
        message = `${message} A sessão local do WhatsApp Web foi restaurada.`;
      } else {
        message = `${message} Não foi possível restaurar todas as abas: ${restoreResult.error}`;
      }
    }

    if (!terminalFailure && session && !TERMINAL_STATUSES.has(session.status)) {
      const failureUpdate = updateStatus(input.token, 'failed', {
        error: message,
        message,
      }).catch(() => null);
      const updated = run.uploadStarted ? await failureUpdate : null;
      if (!run.uploadStarted) void failureUpdate;
      if (updated && isConfirmedTerminalFailure(updated)) {
        terminalFailure = updated;
      }
    }

    const mayRestoreConfirmedFailure = Boolean(terminalFailure);
    if (run.handoffLease && !restoreAttempted && mayRestoreConfirmedFailure) {
      restoreAttempted = true;
      const restoreResult = await restoreWhatsAppWebTabs(run.handoffLease);
      localSessionRestored = restoreResult.ok;
      if (restoreResult.ok) {
        run.handoffLease = null;
        message = `${message} A sessão local do WhatsApp Web foi restaurada.`;
      } else {
        message = `${message} Não foi possível restaurar todas as abas: ${restoreResult.error}`;
      }
    }

    if (run.handoffLease) {
      await publishRunState(run, {
        busy: false,
        message: restoreAttempted
          ? `${message} A restauração será tentada novamente automaticamente.`
          : `${message} A extensão está confirmando o resultado com a Underchat antes de restaurar as abas com segurança.`,
        steps: buildSteps({
          local_cleanup: 'pending',
          session_imported: restoreAttempted ? 'error' : 'active',
          token_pasted: 'done',
          whatsapp_connected: whatsappReadyForHandoff ? 'done' : 'pending',
          whatsapp_open: 'done',
        }),
        tabReady: false,
        title: restoreAttempted
          ? 'Restauração pendente'
          : 'Confirmação pendente',
        tone: 'waiting',
      });
      await scheduleHandoffRecovery().catch(() => undefined);
      throw error;
    }

    await publishRunState(run, {
      busy: false,
      message,
      steps: buildSteps({
        local_cleanup: 'pending',
        session_imported: 'error',
        token_pasted: input.token ? 'done' : 'pending',
        whatsapp_connected: whatsappReadyForHandoff ? 'done' : 'pending',
        whatsapp_open:
          input.tabId && isWhatsAppWebUrl(input.tabUrl) ? 'done' : 'error',
      }),
      tabReady:
        localSessionRestored ||
        Boolean(
          !run.handoffLease && input.tabId && isWhatsAppWebUrl(input.tabUrl)
        ),
      title: 'Não foi possível conectar',
      tone: 'error',
    });
    throw error;
  }
}

async function waitForHandoffReady(
  token: string,
  tabId: number,
  run: ConnectionRun
) {
  const startedAt = Date.now();
  let lastReportedStatus: SecureConnectionStatus | null = null;
  let lastReadiness: WhatsAppReadinessSnapshot = {
    authenticated: false,
    hasBlockingLoginUi: false,
    hasChatUi: false,
    readyForHandoff: false,
    reason: 'waiting_for_chat_ui',
    syncing: false,
  };

  while (Date.now() - startedAt <= HANDOFF_TIMEOUT_MS) {
    throwIfCancelled(run);
    lastReadiness = await executeInMainWorld(tabId, readWhatsAppReadiness);
    throwIfCancelled(run);

    const nextStatus = resolveReadinessStatus(lastReadiness);

    if (nextStatus !== lastReportedStatus) {
      lastReportedStatus = nextStatus;
      await updateStatus(
        token,
        nextStatus,
        {
          message: messageForReadinessStatus(nextStatus),
        },
        run
      ).catch(() => undefined);
      await publishRunState(run, {
        busy: true,
        message: messageForReadinessStatus(nextStatus),
        steps: buildSteps({
          token_pasted: 'done',
          whatsapp_connected: lastReadiness.authenticated ? 'done' : 'active',
          whatsapp_open: 'done',
        }),
        tabReady: true,
        title: titleForReadinessStatus(nextStatus),
        tone: 'busy',
      });
    }

    if (lastReadiness.readyForHandoff) {
      return;
    }

    await sleep(HANDOFF_POLL_MS, run);
  }

  throw new Error(
    !lastReadiness.authenticated
      ? 'Conecte o WhatsApp Web escaneando o QR code ou entrando com o número de telefone e tente novamente.'
      : lastReadiness.syncing
        ? 'O WhatsApp Web ainda está sincronizando. Mantenha o app aberto nos dois dispositivos e tente novamente.'
        : 'O WhatsApp Web ainda não ficou pronto para transferir a sessão.'
  );
}

function resolveReadinessStatus(
  readiness: WhatsAppReadinessSnapshot
): SecureConnectionStatus {
  if (!readiness.authenticated) return 'helper_opened';
  if (readiness.syncing) return 'wa_syncing';
  if (readiness.readyForHandoff) return 'wa_ready';
  return 'wa_authenticated';
}

function messageForReadinessStatus(status: SecureConnectionStatus) {
  if (status === 'helper_opened') {
    return 'Conecte o WhatsApp Web escaneando o QR code ou entrando com o número de telefone.';
  }
  if (status === 'wa_syncing') {
    return 'WhatsApp Web conectado. Aguardando as mensagens carregarem.';
  }
  if (status === 'wa_ready') {
    return 'WhatsApp Web pronto, com mensagens carregadas. Preparando envio.';
  }
  return 'WhatsApp Web conectado. Preparando sessão.';
}

function titleForReadinessStatus(status: SecureConnectionStatus) {
  if (status === 'helper_opened') return 'Conecte o WhatsApp';
  if (status === 'wa_syncing') return 'Sincronizando WhatsApp';
  if (status === 'wa_ready') return 'WhatsApp pronto';
  return 'WhatsApp conectado';
}

async function waitForConnectedConfirmation(
  token: string,
  initialSession: SecureConnectionSessionResponse,
  run: ConnectionRun
) {
  let current = initialSession;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= IMPORT_CONFIRM_TIMEOUT_MS) {
    throwIfCancelled(run);
    if (current.status === 'connected_confirmed') {
      return current;
    }

    if (
      current.status === 'failed' ||
      current.status === 'expired' ||
      current.status === 'cancelled'
    ) {
      throw new ConfirmedTerminalConnectionError(current);
    }

    await publishRunState(run, {
      busy: true,
      message: messageForImportStatus(current.status),
      steps: stepsForImportStatus(current.status),
      tabReady: true,
      title: titleForImportStatus(current.status),
      tone: 'busy',
    });
    await sleep(IMPORT_CONFIRM_POLL_MS, run);
    current = await fetchSecureSession(token, run.abortController.signal);
  }

  throw new Error(
    'A sessão foi enviada, mas a Underchat ainda não confirmou a conexão.'
  );
}

function titleForImportStatus(status: SecureConnectionStatus) {
  if (status === 'session_received') return 'Sessão recebida';
  if (status === 'importing') return 'Importando sessão';
  if (status === 'validating_worker' || status === 'connected') {
    return 'Validando canal';
  }
  return 'Aguardando confirmação';
}

function messageForImportStatus(status: SecureConnectionStatus) {
  if (status === 'session_received') {
    return 'A Underchat recebeu a sessão e está preparando a importação.';
  }
  if (status === 'importing') {
    return 'Restaurando a sessão no worker do canal.';
  }
  if (status === 'validating_worker' || status === 'connected') {
    return 'Sessão importada. Confirmando que o canal ficou online.';
  }
  if (status === 'connected_confirmed') {
    return 'Sessão importada. Canal online.';
  }
  return 'Aguardando confirmação da Underchat.';
}

function stepsForImportStatus(
  status: SecureConnectionStatus
): PopupStepState[] {
  const imported =
    status === 'validating_worker' ||
    status === 'connected' ||
    status === 'connected_confirmed';

  return buildSteps({
    session_imported: imported ? 'done' : 'active',
    token_pasted: 'done',
    whatsapp_connected: 'done',
    whatsapp_open: 'done',
  });
}

async function quiesceWhatsAppWebTabs(input: {
  run: ConnectionRun;
  session: SecureConnectionSessionResponse;
  sourceTabId: number;
}): Promise<WhatsAppHandoffLease> {
  const discoveredTabs = await listWhatsAppWebTabs();
  if (!discoveredTabs.some((tab) => tab.tabId === input.sourceTabId)) {
    throw new Error('A aba usada para extrair a sessão não está mais aberta.');
  }

  const lease: WhatsAppHandoffLease = {
    connectionAttemptId: input.session.connection_attempt_id,
    createdAt: new Date().toISOString(),
    phase: 'quiescing',
    runtimeGeneration: input.session.runtime_generation,
    sourceTabId: input.sourceTabId,
    tabs: discoveredTabs,
    tokenHash: input.session.token_hash,
    uploadStarted: false,
    version: 1,
  };
  input.run.handoffLease = lease;
  await persistHandoffLease(lease);
  await scheduleHandoffRecovery();

  try {
    const initialOrder = [
      ...lease.tabs.filter((tab) => tab.tabId !== input.sourceTabId),
      ...lease.tabs.filter((tab) => tab.tabId === input.sourceTabId),
    ];
    for (const tab of initialOrder) {
      throwIfCancelled(input.run);
      await moveWhatsAppTabToHolding(tab.tabId);
    }

    for (let pass = 0; pass < 3; pass += 1) {
      throwIfCancelled(input.run);
      const remainingTabs = await listWhatsAppWebTabs();
      if (remainingTabs.length === 0) break;

      for (const tab of remainingTabs) {
        if (!lease.tabs.some((known) => known.tabId === tab.tabId)) {
          lease.tabs.push(tab);
          await persistHandoffLease(lease);
        }
        await moveWhatsAppTabToHolding(tab.tabId);
      }
    }

    if ((await listWhatsAppWebTabs()).length > 0) {
      throw new Error(
        'Não foi possível pausar todas as abas do WhatsApp Web antes da importação.'
      );
    }

    lease.phase = 'quiesced';
    await persistHandoffLease(lease);
    await scheduleHandoffRecovery().catch(() => undefined);
    return lease;
  } catch (error) {
    if (!isCancellationError(error)) {
      const restored = await restoreWhatsAppWebTabs(lease);
      if (restored.ok) {
        input.run.handoffLease = null;
      }
    }
    throw error;
  }
}

async function listWhatsAppWebTabs(): Promise<WhatsAppHandoffTab[]> {
  const tabs = await chrome.tabs.query({ url: [WHATSAPP_WEB_URL_PATTERN] });
  const result = new Map<number, WhatsAppHandoffTab>();
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tab.url || !isWhatsAppWebUrl(tab.url)) {
      continue;
    }
    result.set(tab.id, { tabId: tab.id, url: tab.url });
  }
  return [...result.values()];
}

async function guardWhatsAppWebTabDuringHandoff(
  tabId: number,
  url: string
): Promise<void> {
  const lease = activeRun?.handoffLease ?? (await readPersistedHandoffLease());
  if (!lease || !isHandoffOriginGuardPhase(lease.phase)) return;

  if (!lease.tabs.some((savedTab) => savedTab.tabId === tabId)) {
    lease.tabs.push({ tabId, url });
    await persistHandoffLease(lease);
  }
  await moveWhatsAppTabToHolding(tabId);
}

async function enforceWhatsAppWebOriginGuard(
  lease: WhatsAppHandoffLease
): Promise<void> {
  const operation = handoffOriginGuardQueue
    .catch(() => undefined)
    .then(() => enforceWhatsAppWebOriginGuardOnce(lease));
  handoffOriginGuardQueue = operation.catch(() => undefined);
  return operation;
}

async function enforceWhatsAppWebOriginGuardOnce(
  lease: WhatsAppHandoffLease
): Promise<void> {
  if (!isHandoffOriginGuardPhase(lease.phase)) return;
  await handoffTabGuardQueue.catch(() => undefined);
  if (!isHandoffOriginGuardPhase(lease.phase)) return;

  for (let pass = 0; pass < 3; pass += 1) {
    if (!isHandoffOriginGuardPhase(lease.phase)) return;
    const discoveredTabs = await listWhatsAppWebTabs();
    if (!isHandoffOriginGuardPhase(lease.phase)) return;
    if (discoveredTabs.length === 0) return;

    let leaseChanged = false;
    for (const tab of discoveredTabs) {
      if (!isHandoffOriginGuardPhase(lease.phase)) return;
      if (!lease.tabs.some((savedTab) => savedTab.tabId === tab.tabId)) {
        lease.tabs.push(tab);
        leaseChanged = true;
      }
    }
    if (leaseChanged) {
      if (!isHandoffOriginGuardPhase(lease.phase)) return;
      await persistHandoffLease(lease);
    }

    for (const tab of discoveredTabs) {
      if (!isHandoffOriginGuardPhase(lease.phase)) return;
      await moveWhatsAppTabToHolding(tab.tabId);
    }
  }

  if (!isHandoffOriginGuardPhase(lease.phase)) return;
  if ((await listWhatsAppWebTabs()).length > 0) {
    throw new Error(
      'Não foi possível manter todas as abas do WhatsApp pausadas durante a importação.'
    );
  }
}

function isHandoffOriginGuardPhase(phase: HandoffLeasePhase): boolean {
  return (
    phase === 'quiescing' ||
    phase === 'quiesced' ||
    phase === 'cleanup_committing'
  );
}

async function moveWhatsAppTabToHolding(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isWhatsAppWebUrl(tab.url ?? '')) return;

  const holdingUrl = chrome.runtime.getURL(HOLDING_PAGE_PATH);
  await withTimeout(
    chrome.tabs.update(tabId, { url: holdingUrl }).then(() => undefined),
    CLEANUP_OPERATION_TIMEOUT_MS,
    'tempo esgotado ao pausar uma aba do WhatsApp Web'
  );
  await waitForTabUrl(tabId, holdingUrl);
}

async function restoreWhatsAppWebTabs(
  lease: WhatsAppHandoffLease,
  options: { clearLease?: boolean; preservePhase?: boolean } = {}
): Promise<{ error?: string; ok: boolean; restoredTabIds: number[] }> {
  try {
    return await restoreWhatsAppWebTabsOnce(lease, options);
  } catch (error) {
    await persistHandoffLease(lease).catch(() => undefined);
    await scheduleHandoffRecovery().catch(() => undefined);
    return {
      error: sanitizeError(error),
      ok: false,
      restoredTabIds: [],
    };
  }
}

async function restoreWhatsAppWebTabsOnce(
  lease: WhatsAppHandoffLease,
  options: { clearLease?: boolean; preservePhase?: boolean } = {}
): Promise<{ error?: string; ok: boolean; restoredTabIds: number[] }> {
  const restorationPhase = options.preservePhase ? lease.phase : 'restoring';
  if (!options.preservePhase) {
    lease.phase = restorationPhase;
    await persistHandoffLease(lease);
  }

  await handoffOriginGuardQueue.catch(() => undefined);
  await handoffTabGuardQueue.catch(() => undefined);
  lease.phase = restorationPhase;
  await persistHandoffLease(lease);

  const holdingUrl = chrome.runtime.getURL(HOLDING_PAGE_PATH);
  const restoredTabIds: number[] = [];
  const errors: string[] = [];

  for (const savedTab of lease.tabs) {
    const current = await chrome.tabs.get(savedTab.tabId).catch(() => null);
    if (!current) continue;

    const currentUrl = current.url?.trim() ?? '';
    if (!currentUrl) {
      errors.push(
        `${savedTab.tabId}: não foi possível ler a URL atual da aba ` +
          `(pendingUrl=${describeTabUrl(current.pendingUrl)}, status=${current.status ?? 'indisponível'})`
      );
      continue;
    }
    if (isWhatsAppWebUrl(currentUrl)) {
      restoredTabIds.push(savedTab.tabId);
      continue;
    }
    if (!currentUrl.startsWith(holdingUrl)) {
      continue;
    }

    try {
      await withTimeout(
        chrome.tabs
          .update(savedTab.tabId, { url: savedTab.url })
          .then(() => undefined),
        CLEANUP_OPERATION_TIMEOUT_MS,
        'tempo esgotado ao restaurar uma aba do WhatsApp Web'
      );
      await waitForTabUrl(savedTab.tabId, WHATSAPP_WEB_ORIGIN);
      restoredTabIds.push(savedTab.tabId);
    } catch (error) {
      errors.push(`${savedTab.tabId}: ${sanitizeError(error)}`);
    }
  }

  if (errors.length > 0) {
    await persistHandoffLease(lease);
    return {
      error: errors.join('; '),
      ok: false,
      restoredTabIds,
    };
  }

  if (options.clearLease !== false) {
    await clearPersistedHandoffLease();
  }
  return { ok: true, restoredTabIds };
}

async function runCleanupWithFinalVerification(
  lease: WhatsAppHandoffLease
): Promise<{ error?: string; ok: boolean }> {
  try {
    return await withTimeout(
      commitWhatsAppWebCleanup(lease),
      CLEANUP_TOTAL_TIMEOUT_MS,
      'tempo esgotado ao concluir limpeza local do WhatsApp Web'
    );
  } catch (error) {
    return { error: sanitizeError(error), ok: false };
  }
}

async function commitWhatsAppWebCleanup(
  lease: WhatsAppHandoffLease
): Promise<{ error?: string; ok: boolean }> {
  lease.phase = 'cleanup_committing';
  await persistHandoffLease(lease);

  await withTimeout(
    chrome.browsingData.remove(
      { origins: [WHATSAPP_WEB_ORIGIN] },
      {
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true,
      }
    ),
    CLEANUP_OPERATION_TIMEOUT_MS,
    'tempo esgotado ao remover dados locais do WhatsApp Web'
  );

  lease.phase = 'origin_cleared';
  await persistHandoffLease(lease);
  const restored = await restoreWhatsAppWebTabs(lease, {
    clearLease: false,
    preservePhase: true,
  });
  if (!restored.ok) {
    return restored;
  }

  if (restored.restoredTabIds.length === 0) {
    await clearPersistedHandoffLease();
    return { ok: true };
  }

  const verification = await verifyRestoredWhatsAppTabs(
    restored.restoredTabIds
  );
  if (!verification.ok) return verification;

  await clearPersistedHandoffLease();
  return { ok: true };
}

async function verifyRestoredWhatsAppTabs(
  tabIds: number[]
): Promise<{ error?: string; ok: boolean }> {
  const verifications = await Promise.all(
    tabIds.map(async (tabId) => ({
      result: await verifyWhatsAppWebCleanup(tabId),
      tabId,
    }))
  );
  const failed = verifications.filter(({ result }) => !result.ok);
  if (failed.length === 0) return { ok: true };

  return {
    error: failed
      .map(
        ({ result, tabId }) =>
          `aba ${tabId}: ${result.error ?? 'limpeza não confirmada'}`
      )
      .join('; '),
    ok: false,
  };
}

async function verifyWhatsAppWebCleanup(
  tabId: number
): Promise<{ error?: string; ok: boolean }> {
  const startedAt = Date.now();
  let lastReason = 'cleanup_verification_not_started';
  let stableLoggedOutSamples = 0;

  while (Date.now() - startedAt <= CLEANUP_VERIFY_TIMEOUT_MS) {
    try {
      const snapshot = await withTimeout(
        executeInMainWorld(tabId, readWhatsAppCleanupSnapshot),
        CLEANUP_PAGE_CONTEXT_TIMEOUT_MS,
        'tempo esgotado ao verificar limpeza do WhatsApp Web'
      );
      lastReason = snapshot.reason;

      if (snapshot.hasLoginUi && !snapshot.hasChatUi) {
        return { ok: true };
      }

      if (snapshot.loggedOut) {
        stableLoggedOutSamples += 1;
      } else {
        stableLoggedOutSamples = 0;
      }

      if (stableLoggedOutSamples >= CLEANUP_REQUIRED_STABLE_SAMPLES) {
        return { ok: true };
      }
    } catch (error) {
      lastReason = sanitizeError(error);
      stableLoggedOutSamples = 0;
    }

    await sleep(CLEANUP_VERIFY_POLL_MS);
  }

  return {
    error: `a sessão ainda parece autenticada no WhatsApp Web (${lastReason})`,
    ok: false,
  };
}

async function waitForTabUrl(
  tabId: number,
  expectedUrlPrefix: string
): Promise<void> {
  const startedAt = Date.now();
  let lastObservedTab: ChromeTab | null = null;

  while (Date.now() - startedAt <= CLEANUP_VERIFY_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId);
    lastObservedTab = tab;
    if (
      (tab.url ?? '').startsWith(expectedUrlPrefix) &&
      tab.status === 'complete'
    ) {
      return;
    }
    await sleep(CLEANUP_VERIFY_POLL_MS);
  }

  throw new Error(
    'tempo esgotado ao aguardar a aba do WhatsApp Web ' +
      `(url=${describeTabUrl(lastObservedTab?.url)}, ` +
      `pendingUrl=${describeTabUrl(lastObservedTab?.pendingUrl)}, ` +
      `status=${lastObservedTab?.status ?? 'indisponível'})`
  );
}

async function readWhatsAppCleanupSnapshot(): Promise<{
  authenticated: boolean;
  hasAuthLocalStorage: boolean;
  hasChatUi: boolean;
  hasLoginUi: boolean;
  href: string;
  loggedOut: boolean;
  reason: string;
}> {
  if (!location.origin.startsWith('https://web.whatsapp.com')) {
    return {
      authenticated: false,
      hasAuthLocalStorage: false,
      hasChatUi: false,
      hasLoginUi: false,
      href: location.href,
      loggedOut: false,
      reason: 'not_whatsapp_web',
    };
  }

  const text = document.body?.innerText ?? '';
  const hasLoginText = [
    /use\s+whatsapp\s+(?:on|in)\s+your\s+computer/i,
    /log\s+in\s+to\s+whatsapp/i,
    /link\s+with\s+phone\s+number/i,
    /scan\s+(?:the\s+)?qr/i,
    /scan\s+to\s+(?:log\s+in|link)/i,
    /escaneie\s+para\s+entrar/i,
    /escaneie\s+o\s+c[oó]digo\s+qr/i,
    /entrar\s+com\s+n[uú]mero\s+de\s+telefone/i,
    /use\s+o\s+whatsapp\s+no\s+seu\s+computador/i,
  ].some((pattern) => pattern.test(text));
  const hasLoginUi =
    hasLoginText ||
    [
      'canvas[aria-label*="Scan"]',
      'canvas[aria-label*="Escane"]',
      '[data-testid="qrcode"]',
      '[data-ref] canvas',
      'input[name="phone"]',
    ].some((selector) => document.querySelector(selector));
  const hasChatUi = [
    '#side',
    '[data-testid="chat-list"]',
    '[data-testid="conversation-list"]',
    '[data-testid="conversation-panel-wrapper"]',
    '[aria-label="Chat list"]',
    '[aria-label="Lista de conversas"]',
    '[contenteditable="true"][role="textbox"]',
  ].some((selector) => document.querySelector(selector));
  const hasAuthLocalStorage = [
    'last-wid',
    'last-wid-md',
    'last-wid-lid',
    'WALid',
    'WANoiseInfo',
    'NOISE_INFO',
    'MD_NOISE_KEYS',
  ].some((key) => Boolean(localStorage.getItem(key)));
  const databaseNames =
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
  const hasSignalStorageDatabase = databaseNames.includes('signal-storage');
  const loginUiVisible = hasLoginUi && !hasChatUi;
  const authenticated = hasChatUi && !hasLoginUi;
  const loggedOut =
    loginUiVisible ||
    (!hasChatUi && !hasAuthLocalStorage && !hasSignalStorageDatabase);
  const reason = authenticated
    ? 'chat_ui_still_authenticated'
    : loggedOut
      ? loginUiVisible
        ? 'login_ui_visible'
        : 'local_session_removed'
      : hasAuthLocalStorage
        ? 'auth_local_storage_residue_without_chat_ui'
        : 'waiting_for_logged_out_ui';

  return {
    authenticated,
    hasAuthLocalStorage,
    hasChatUi,
    hasLoginUi,
    href: location.href,
    loggedOut,
    reason,
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function executeInMainWorld<T>(
  tabId: number,
  func: () => T | Promise<T>
): Promise<T>;
async function executeInMainWorld<T, Argument>(
  tabId: number,
  func: (argument: Argument) => T | Promise<T>,
  argument: Argument
): Promise<T>;
async function executeInMainWorld<T, Argument>(
  tabId: number,
  func: (() => T | Promise<T>) | ((argument: Argument) => T | Promise<T>),
  argument?: Argument
): Promise<T> {
  const [result] = await chrome.scripting.executeScript<T>({
    args: argument === undefined ? undefined : [argument],
    func: func as (...args: unknown[]) => T | Promise<T>,
    target: { tabId },
    world: 'MAIN',
  });

  if (result?.result === undefined) {
    throw new Error(
      'A aba do WhatsApp Web não retornou dados para a extensão.'
    );
  }

  return result.result;
}

async function updateStatus(
  token: string,
  status: SecureConnectionStatus,
  details: { error?: string; message?: string } = {},
  run?: ConnectionRun
) {
  return updateSecureStatus({
    error: details.error,
    message: details.message,
    signal: run?.abortController.signal,
    status,
    token,
  });
}

async function cancelConnection(
  run: ConnectionRun
): Promise<{ pending: boolean }> {
  run.cancelled = true;
  run.abortController.abort();
  await run.settled;
  run.handoffLease = await readPersistedHandoffLease();

  if (run.handoffLease && !run.uploadStarted) {
    const restored = await restoreWhatsAppWebTabs(run.handoffLease);
    if (restored.ok) {
      run.handoffLease = null;
    }
  }

  let cancelledSession: SecureConnectionSessionResponse | null = null;
  if (run.token) {
    const cancellationUpdate = updateSecureStatus({
      message: 'Fluxo cancelado pelo usuário na extensão Chrome.',
      status: 'cancelled',
      token: run.token,
    }).catch(() => null);
    cancelledSession = run.uploadStarted ? await cancellationUpdate : null;
    if (!run.uploadStarted) void cancellationUpdate;
  }

  const mayRestoreConfirmedFailure = Boolean(
    cancelledSession && isConfirmedTerminalFailure(cancelledSession)
  );
  if (run.handoffLease && mayRestoreConfirmedFailure) {
    const restored = await restoreWhatsAppWebTabs(run.handoffLease);
    if (restored.ok) {
      run.handoffLease = null;
    }
  }

  if (run.handoffLease) {
    await publishState({
      busy: false,
      message:
        'O cancelamento ainda não foi confirmado pela Underchat. As abas do WhatsApp permanecem pausadas para evitar duas conexões simultâneas.',
      steps: buildSteps({
        session_imported: 'active',
        token_pasted: 'done',
        whatsapp_connected: 'done',
        whatsapp_open: 'done',
      }),
      tabReady: false,
      title: 'Cancelamento pendente',
      tone: 'waiting',
    });
    await scheduleHandoffRecovery().catch(() => undefined);
    return { pending: true };
  }

  await clearPersistedConnectionToken();
  await publishState(createInitialState());
  return { pending: false };
}

async function cancelStoredConnection(
  token: string
): Promise<{ pending: boolean }> {
  let lease = await readPersistedHandoffLease();
  if (lease && !lease.uploadStarted) {
    const restored = await restoreWhatsAppWebTabs(lease);
    if (restored.ok) {
      lease = null;
    }
  }

  let cancelledSession: SecureConnectionSessionResponse | null = null;
  if (token) {
    cancelledSession = await updateSecureStatus({
      message: 'Fluxo cancelado pelo usuário na extensão Chrome.',
      status: 'cancelled',
      token,
    }).catch(() => null);
  }

  if (
    lease &&
    (lease.phase === 'quiescing' ||
      Boolean(cancelledSession && isConfirmedTerminalFailure(cancelledSession)))
  ) {
    const restored = await restoreWhatsAppWebTabs(lease);
    if (!restored.ok) {
      await publishState({
        busy: false,
        message: `O fluxo foi cancelado, mas não foi possível restaurar todas as abas: ${restored.error}`,
        steps: buildSteps({ session_imported: 'error' }),
        tabReady: false,
        title: 'Restauração pendente',
        tone: 'waiting',
      });
      await scheduleHandoffRecovery().catch(() => undefined);
      return { pending: true };
    }
  } else if (lease) {
    await publishState({
      busy: false,
      message:
        'O cancelamento ainda não foi confirmado pela Underchat. As abas do WhatsApp permanecem pausadas.',
      steps: buildSteps({ session_imported: 'active' }),
      tabReady: false,
      title: 'Cancelamento pendente',
      tone: 'waiting',
    });
    await scheduleHandoffRecovery().catch(() => undefined);
    return { pending: true };
  }

  await clearPersistedConnectionToken();
  await publishState(createInitialState());
  return { pending: false };
}

async function completeObservedLocalCleanup(token: string): Promise<void> {
  const run = activeRun;
  if (run && (!token || run.token === token)) {
    run.cancelled = true;
    run.abortController.abort();
    await run.settled;
  }

  await clearPersistedHandoffLease();
  await clearPersistedConnectionToken();
  await publishState(createInitialState());
}

async function publishState(state: PopupConnectionState) {
  await chrome.storage.local.set({ [POPUP_STATE_KEY]: state });
  await notifyPopup(state);
}

async function persistConnectionToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [POPUP_TOKEN_KEY]: token });
}

async function clearPersistedConnectionToken(): Promise<void> {
  await chrome.storage.local.remove(POPUP_TOKEN_KEY);
}

async function persistHandoffLease(lease: WhatsAppHandoffLease): Promise<void> {
  await chrome.storage.local.set({ [HANDOFF_LEASE_KEY]: lease });
}

async function clearPersistedHandoffLease(): Promise<void> {
  await chrome.storage.local.remove(HANDOFF_LEASE_KEY);
  await chrome.alarms.clear(HANDOFF_RECOVERY_ALARM).catch(() => false);
}

async function readPersistedHandoffLease(): Promise<WhatsAppHandoffLease | null> {
  const stored =
    await chrome.storage.local.get<Record<string, unknown>>(HANDOFF_LEASE_KEY);
  const value = stored[HANDOFF_LEASE_KEY];
  if (!isRecord(value) || value.version !== 1) return null;

  const phase = value.phase;
  const validPhases = new Set<HandoffLeasePhase>([
    'quiescing',
    'quiesced',
    'cleanup_committing',
    'origin_cleared',
    'restoring',
  ]);
  if (
    typeof phase !== 'string' ||
    !validPhases.has(phase as HandoffLeasePhase)
  ) {
    return null;
  }
  if (
    typeof value.connectionAttemptId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.sourceTabId !== 'number' ||
    typeof value.tokenHash !== 'string' ||
    (value.uploadStarted !== undefined &&
      typeof value.uploadStarted !== 'boolean') ||
    !Array.isArray(value.tabs)
  ) {
    return null;
  }

  const tabs: WhatsAppHandoffTab[] = [];
  for (const candidate of value.tabs) {
    if (
      !isRecord(candidate) ||
      typeof candidate.tabId !== 'number' ||
      typeof candidate.url !== 'string' ||
      !isWhatsAppWebUrl(candidate.url)
    ) {
      return null;
    }
    tabs.push({ tabId: candidate.tabId, url: candidate.url });
  }

  return {
    connectionAttemptId: value.connectionAttemptId,
    createdAt: value.createdAt,
    phase: phase as HandoffLeasePhase,
    ...(typeof value.runtimeGeneration === 'number'
      ? { runtimeGeneration: value.runtimeGeneration }
      : {}),
    sourceTabId: value.sourceTabId,
    tabs,
    tokenHash: value.tokenHash,
    uploadStarted:
      typeof value.uploadStarted === 'boolean'
        ? value.uploadStarted
        : phase !== 'quiescing',
    version: 1,
  };
}

async function recoverPersistedHandoffLease(): Promise<void> {
  if (handoffRecoveryInProgress) return;
  handoffRecoveryInProgress = true;

  try {
    await recoverPersistedHandoffLeaseOnce();
  } finally {
    handoffRecoveryInProgress = false;
  }
}

async function recoverPersistedHandoffLeaseOnce(): Promise<void> {
  const lease = await readPersistedHandoffLease();
  if (!lease) return;
  if (activeRun) {
    const activeLease = activeRun.handoffLease;
    if (
      activeLease &&
      activeLease.connectionAttemptId === lease.connectionAttemptId
    ) {
      await enforceWhatsAppWebOriginGuard(activeLease).catch(() => undefined);
    }
    await scheduleHandoffRecovery();
    return;
  }

  if (
    lease.phase === 'quiescing' ||
    lease.phase === 'restoring' ||
    (lease.phase === 'quiesced' && !lease.uploadStarted)
  ) {
    const restored = await restoreWhatsAppWebTabs(lease);
    if (restored.ok) {
      await clearPersistedConnectionToken();
      await publishState(createInitialState());
    } else {
      await publishState(createRestorationPendingState(restored.error));
      await scheduleHandoffRecovery();
    }
    return;
  }

  if (lease.phase === 'origin_cleared') {
    const restored = await restoreWhatsAppWebTabs(lease, {
      clearLease: false,
      preservePhase: true,
    });
    const verification = restored.ok
      ? await verifyRestoredWhatsAppTabs(restored.restoredTabIds)
      : restored;
    if (verification.ok) {
      await clearPersistedHandoffLease();
      await clearPersistedConnectionToken();
      await publishState(createInitialState());
    } else {
      for (const savedTab of lease.tabs) {
        await moveWhatsAppTabToHolding(savedTab.tabId).catch(() => undefined);
      }
      await publishState(createCleanupPendingState(verification.error));
      await scheduleHandoffRecovery();
    }
    return;
  }

  const stored =
    await chrome.storage.local.get<Record<string, unknown>>(POPUP_TOKEN_KEY);
  const token =
    typeof stored[POPUP_TOKEN_KEY] === 'string'
      ? stored[POPUP_TOKEN_KEY].trim()
      : '';
  if (!token) {
    await publishState(
      createConfirmationPendingState(
        'O token seguro não está disponível no armazenamento local.'
      )
    );
    await scheduleHandoffRecovery().catch(() => undefined);
    return;
  }

  const session = await fetchSecureSession(token).catch(() => null);
  if (!session) {
    await publishState(
      createConfirmationPendingState(
        'A Underchat ainda não respondeu à consulta de status.'
      )
    );
    await scheduleHandoffRecovery().catch(() => undefined);
    return;
  }

  if (
    session.token_hash !== lease.tokenHash ||
    session.connection_attempt_id !== lease.connectionAttemptId ||
    (lease.runtimeGeneration !== undefined &&
      session.runtime_generation !== lease.runtimeGeneration)
  ) {
    await publishState(
      createConfirmationPendingState(
        'A resposta recebida não corresponde à tentativa de conexão protegida.'
      )
    );
    await scheduleHandoffRecovery().catch(() => undefined);
    return;
  }

  if (isConfirmedTerminalFailure(session)) {
    const restored = await restoreWhatsAppWebTabs(lease);
    if (restored.ok) {
      await clearPersistedConnectionToken();
      await publishState(createInitialState());
    } else {
      await publishState(createRestorationPendingState(restored.error));
      await scheduleHandoffRecovery();
    }
    return;
  }

  if (session.status === 'connected_confirmed') {
    const cleanup = await runCleanupWithFinalVerification(lease);
    if (cleanup.ok) {
      await clearPersistedConnectionToken();
      await publishState(createInitialState());
    } else {
      await publishState(createCleanupPendingState(cleanup.error));
      await scheduleHandoffRecovery();
    }
    return;
  }

  await scheduleHandoffRecovery();
}

async function scheduleHandoffRecovery(): Promise<void> {
  await chrome.alarms.create(HANDOFF_RECOVERY_ALARM, {
    when: Date.now() + HANDOFF_RECOVERY_DELAY_MS,
  });
}

async function publishRunState(
  run: ConnectionRun,
  state: PopupConnectionState
) {
  if (!isRunActive(run)) {
    return;
  }

  await publishState(state);
}

async function notifyPopup(state: PopupConnectionState) {
  await chrome.runtime
    .sendMessage({
      payload: state,
      type: 'underchat:connection_state',
    })
    .catch(() => undefined);
}

function isWhatsAppWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === WHATSAPP_WEB_ORIGIN;
  } catch {
    return false;
  }
}

function describeTabUrl(value: string | undefined): string {
  if (!value) return 'indisponível';

  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'inválida';
  }
}

function isConfirmedTerminalFailure(
  session: SecureConnectionSessionResponse
): boolean {
  return (
    session.status === 'failed' ||
    session.status === 'expired' ||
    session.status === 'cancelled'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return normalizeUserVisibleError(message).slice(0, 280);
}

function normalizeUserVisibleError(message: string): string {
  if (message === 'secure_import_restore_started') {
    return 'A sessão foi enviada e o WWebJS iniciou a restauração, mas não confirmou a conexão.';
  }

  if (message.startsWith('secure_import_wwebjs_no_progress')) {
    return 'A sessão foi enviada, mas o WWebJS não conseguiu inicializar o cliente a partir da sessão importada. Gere um novo token e tente novamente.';
  }

  if (
    message.includes('No client instance') ||
    message.includes('missing_client')
  ) {
    return 'A sessão foi enviada, mas o worker WWebJS não criou a instância do cliente. Gere um novo token e tente novamente.';
  }

  if (
    message.startsWith('secure_import_runtime_not_ready') &&
    message.includes('Waiting failed')
  ) {
    return 'A sessão foi enviada, mas o WWebJS não confirmou a conexão dentro do tempo esperado.';
  }

  if (message === 'secure_import_runtime_validation_timeout') {
    return 'A sessão foi enviada, mas a Underchat não confirmou a conexão dentro do tempo esperado.';
  }

  return message;
}

function createInitialState(): PopupConnectionState {
  return {
    busy: false,
    message:
      'Abra uma aba do WhatsApp Web autenticada, cole o token do canal e inicie a conexão.',
    steps: buildSteps({}),
    tabReady: true,
    title: 'Aguardando token',
    tone: 'waiting',
  };
}

function createRestorationPendingState(error?: string): PopupConnectionState {
  return {
    busy: false,
    message: error
      ? `A restauração das abas ainda não foi concluída: ${error}. A extensão tentará novamente automaticamente.`
      : 'A restauração das abas ainda não foi concluída. A extensão tentará novamente automaticamente.',
    steps: buildSteps({
      local_cleanup: 'pending',
      session_imported: 'error',
      token_pasted: 'done',
      whatsapp_connected: 'done',
      whatsapp_open: 'done',
    }),
    tabReady: false,
    title: 'Restauração pendente',
    tone: 'waiting',
  };
}

function createCleanupPendingState(error?: string): PopupConnectionState {
  return {
    busy: false,
    message: error
      ? `Canal conectado. A limpeza/restauração local ainda não foi concluída: ${error}. A extensão tentará novamente automaticamente.`
      : 'Canal conectado. A limpeza/restauração local ainda não foi concluída. A extensão tentará novamente automaticamente.',
    steps: buildSteps({
      local_cleanup: 'active',
      session_imported: 'done',
      token_pasted: 'done',
      whatsapp_connected: 'done',
      whatsapp_open: 'done',
    }),
    tabReady: false,
    title: 'Limpeza/restauração pendente',
    tone: 'waiting',
  };
}

function createConfirmationPendingState(reason?: string): PopupConnectionState {
  return {
    busy: false,
    message: reason
      ? `${reason} As abas permanecem pausadas enquanto a extensão tenta confirmar o resultado com segurança.`
      : 'As abas permanecem pausadas enquanto a extensão tenta confirmar o resultado com segurança.',
    steps: buildSteps({
      local_cleanup: 'pending',
      session_imported: 'active',
      token_pasted: 'done',
      whatsapp_connected: 'done',
      whatsapp_open: 'done',
    }),
    tabReady: false,
    title: 'Confirmação pendente',
    tone: 'waiting',
  };
}

function isRunActive(run: ConnectionRun): boolean {
  return (
    activeRun === run && !run.cancelled && !run.abortController.signal.aborted
  );
}

function throwIfCancelled(run: ConnectionRun): void {
  if (!isRunActive(run)) {
    throw new Error('connection_cancelled');
  }
}

function isCancellationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === 'connection_cancelled' || error.name === 'AbortError')
  );
}

function buildSteps(
  statuses: Partial<Record<PopupStepId, PopupStepStatus>>
): PopupStepState[] {
  return STEP_IDS.map((id) => ({
    id,
    status: statuses[id] ?? 'pending',
  }));
}

function sleep(ms: number, run?: ConnectionRun): Promise<void> {
  return new Promise((resolve, reject) => {
    if (run && !isRunActive(run)) {
      reject(new Error('connection_cancelled'));
      return;
    }

    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('connection_cancelled'));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      if (run) {
        run.abortController.signal.removeEventListener('abort', cancel);
      }
      resolve();
    };

    if (run) {
      run.abortController.signal.addEventListener('abort', cancel, {
        once: true,
      });
    }

    timeout = setTimeout(finish, ms);
  });
}
