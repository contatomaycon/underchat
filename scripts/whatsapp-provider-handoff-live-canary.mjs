import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  Centrifuge,
  State as CentrifugeState,
  SubscriptionState,
} from 'centrifuge';
import { config as loadEnv } from 'dotenv';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Keep the canary in product terminology. Provider identifiers are only used
 * for API-level connection-status validation and never emitted in its report.
 */
export const WHATSAPP_OPTIONS = Object.freeze({
  option1: Object.freeze({
    id: '019a930d-c6f6-766d-9c84-53307d4159a1',
    provider: 'baileys',
    label: 'Opção 1 (Socket)',
  }),
  option2: Object.freeze({
    id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
    provider: 'wwebjs',
    label: 'Opção 2 (Navegador)',
  }),
  option3: Object.freeze({
    id: 'e80ad183-2b46-4628-9105-a036f2d28720',
    provider: 'whatsmeow',
    label: 'Opção 3 (Socket)',
  }),
});

/**
 * Covers every directed pair once, starting and ending at Option 1. The
 * sequence deliberately does not recreate, reset, request a QR code, or use
 * database access: every transition goes through the user-facing worker API.
 */
export const DIRECTED_HANDOFF_SEQUENCE = Object.freeze([
  Object.freeze({
    from: WHATSAPP_OPTIONS.option1,
    to: WHATSAPP_OPTIONS.option3,
  }),
  Object.freeze({
    from: WHATSAPP_OPTIONS.option3,
    to: WHATSAPP_OPTIONS.option2,
  }),
  Object.freeze({
    from: WHATSAPP_OPTIONS.option2,
    to: WHATSAPP_OPTIONS.option1,
  }),
  Object.freeze({
    from: WHATSAPP_OPTIONS.option1,
    to: WHATSAPP_OPTIONS.option2,
  }),
  Object.freeze({
    from: WHATSAPP_OPTIONS.option2,
    to: WHATSAPP_OPTIONS.option3,
  }),
  Object.freeze({
    from: WHATSAPP_OPTIONS.option3,
    to: WHATSAPP_OPTIONS.option1,
  }),
]);

export function directedHandoffSequenceFrom(initialOption) {
  const startIndex = DIRECTED_HANDOFF_SEQUENCE.findIndex(
    ({ from }) => from.id === initialOption?.id
  );
  if (startIndex < 0) {
    throw new Error(
      'The initial worker type is not a supported WhatsApp option.'
    );
  }
  return Object.freeze([
    ...DIRECTED_HANDOFF_SEQUENCE.slice(startIndex),
    ...DIRECTED_HANDOFF_SEQUENCE.slice(0, startIndex),
  ]);
}

export const CANARY_LOGIN_SESSION_PLATFORM = 'mobile';

const ACTIVE_RECOVERY_STATES = new Set(['pending', 'dispatching', 'running']);
const INTERACTIVE_LOGIN_CODES = new Map([
  [201, 'new_login_attempt'],
  [202, 'awaiting_qr'],
  [204, 'awaiting_pairing_code'],
  [206, 'pairing_in_progress'],
  [207, 'awaiting_passkey'],
  [208, 'awaiting_passkey_confirmation'],
]);
const SAFE_EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_CURSOR_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;

const args = process.argv.slice(2);
const envFile = optionValue('--env-file') ?? process.env.E2E_ENV_FILE ?? '.env';
loadEnv({ path: envFile, quiet: true });

const options = {
  apiUrl: normalizeBaseUrl(
    optionValue('--api-url') ??
      process.env.E2E_API_URL ??
      'http://localhost:3002/v1'
  ),
  workerId: optionValue('--worker-id'),
  confirmLive: hasFlag('--confirm-live'),
  dryRun: hasFlag('--dry-run'),
  apiTimeoutMs: positiveIntegerOption('--api-timeout-ms', 35_000),
  realtimeTimeoutMs: positiveIntegerOption('--realtime-timeout-ms', 35_000),
  pollIntervalMs: positiveIntegerOption('--poll-interval-ms', 2_000),
  cooldownTimeoutMs: positiveIntegerOption('--cooldown-timeout-ms', 600_000),
  handoffTimeoutMs: positiveIntegerOption('--handoff-timeout-ms', 720_000),
  compensationTimeoutMs: positiveIntegerOption(
    '--compensation-timeout-ms',
    720_000
  ),
  reportDirectory: path.resolve(
    ROOT,
    optionValue('--report-directory') ?? 'test-results'
  ),
};

const report = {
  canary: 'whatsapp-provider-handoff-live',
  started_at: new Date().toISOString(),
  api_url: publicApiUrl(options.apiUrl),
  worker_id: options.workerId ?? null,
  mode: options.dryRun ? 'dry_run' : 'live',
  sequence: [],
  steps: [],
  failures: [],
};

let token = null;

function printUsage() {
  console.log(`Usage:
  node scripts/whatsapp-provider-handoff-live-canary.mjs \\
    --worker-id=<uuid> --confirm-live [options]

Options:
  --api-url=<url>                 Manager API base URL (default: E2E_API_URL or localhost)
  --env-file=<path>               Environment file (default: E2E_ENV_FILE or .env)
  --dry-run                       Validate the current channel only; do not change it
  --poll-interval-ms=<milliseconds>
  --realtime-timeout-ms=<milliseconds>
  --cooldown-timeout-ms=<milliseconds>
  --handoff-timeout-ms=<milliseconds>
  --compensation-timeout-ms=<milliseconds>
  --report-directory=<path>       Relative to the repository root

Authentication prefers HANDOFF_CANARY_TOKEN. A dry-run requires that token so
it remains GET-only. In live mode, if it is absent, the canary uses
HANDOFF_CANARY_LOGIN/HANDOFF_CANARY_PASSWORD or E2E_LOGIN/E2E_PASSWORD to open
an isolated mobile API session, without replacing the active web session.
Secrets, QR data, and full phone numbers are never written to the report.`);
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return false;
  }

  if (!options.workerId) {
    throw new Error('Missing required --worker-id=<uuid>.');
  }
  if (!options.dryRun && !options.confirmLive) {
    throw new Error(
      'Refusing to change a live channel without --confirm-live. Use --dry-run for preflight only.'
    );
  }

  token = await resolveAuthenticationToken(login, {
    allowLogin: !options.dryRun,
  });

  const baseline = await readWorker(options.workerId);
  const baselineOption = assertInitialWorker(baseline);
  const sequence = directedHandoffSequenceFrom(baselineOption);
  const baselineIdentity = {
    workerId: baseline.id,
    number: baseline.number,
  };
  const baselineAccountId = baseline?.account?.id;
  report.sequence = sequence.map(({ from, to }) => ({
    from: from.label,
    to: to.label,
  }));
  report.baseline = publicWorker(baseline);

  const initialHandoff = await viewLatestHandoff(options.workerId);
  report.initial_handoff = publicHandoff(initialHandoff);
  assertNoUnresolvedHandoff(initialHandoff, 'before starting the canary');

  if (options.dryRun) {
    report.outcome = 'passed';
    return;
  }

  if (typeof baselineAccountId !== 'string' || baselineAccountId.length === 0) {
    throw new Error('Worker view did not include an account id.');
  }

  try {
    for (const [index, transition] of sequence.entries()) {
      await runTransition({
        index: index + 1,
        total: sequence.length,
        transition,
        baselineIdentity,
        accountId: baselineAccountId,
      });
    }
    const finalWorker = await readWorker(options.workerId);
    assertHealthyWorker(finalWorker, baselineOption, baselineIdentity);
    const finalHandoff = await viewLatestHandoff(options.workerId);
    assertCompletedHandoff(finalHandoff, baselineOption, 'final');
    report.final = {
      worker: publicWorker(finalWorker),
      handoff: publicHandoff(finalHandoff),
    };
  } catch (error) {
    report.primary_failure = errorMessage(error);
    report.compensation = await safelyRestoreInitialProvider({
      initialOption: baselineOption,
      baselineIdentity,
      accountId: baselineAccountId,
    });
    throw error;
  }
  report.outcome = 'passed';
  return true;
}

async function runTransition({
  index,
  total,
  transition,
  baselineIdentity,
  accountId,
  stepCollection = report.steps,
  isCompensation = false,
}) {
  const startedAt = Date.now();
  const step = {
    index,
    from: transition.from.label,
    to: transition.to.label,
    started_at: new Date().toISOString(),
    phase: isCompensation ? 'compensation' : 'matrix',
  };
  stepCollection.push(step);
  console.log(
    `${isCompensation ? 'RESTORE' : 'START'} ${index}/${total}: ${step.from} → ${step.to}`
  );

  let monitor = null;
  let afterOrder = null;
  let operationId = null;
  let traceId = null;

  try {
    const current = await readWorker(options.workerId);
    assertHealthyWorker(current, transition.from, baselineIdentity);
    assertNoUnresolvedHandoff(
      await viewLatestHandoff(options.workerId),
      `before transition ${index}`
    );
    await waitForCooldown(current, transition.from, baselineIdentity);

    monitor = await createRealtimeTransitionMonitor({
      accountId,
      workerId: options.workerId,
    });
    const baselineEvidence = await viewHandoffEvidence(options.workerId);
    afterOrder = assertEvidenceBaseline(baselineEvidence);
    monitor.setAfterOrder(afterOrder);

    traceId = `live_provider_handoff_canary_${randomUUID()}`;
    monitor.setExpectedCorrelation({ traceId });
    const acknowledgement = await api(
      'PATCH',
      `/worker/${encodeURIComponent(options.workerId)}/${encodeURIComponent(current.name)}`,
      {
        body: { worker_type: transition.to.id },
        traceId,
      }
    );
    operationId = acknowledgement?.operation_id;
    if (
      typeof operationId !== 'string' ||
      !SAFE_EVENT_ID_PATTERN.test(operationId)
    ) {
      throw new Error(
        'The handoff acknowledgement did not include an operation id.'
      );
    }
    monitor.setExpectedCorrelation({ operationId, traceId });
    step.operation_id = publicOperationId(operationId);
    step.debug_trace_id = publicTraceId(
      acknowledgement?.debug_trace_id ?? traceId
    );
    const settled = await waitForSuccessfulHandoff({
      transition,
      baselineIdentity,
      startedAt,
      operationId,
      monitor,
    });
    const evidence = await waitForDurableEvidence({
      workerId: options.workerId,
      afterOrder,
      operationId,
      traceId,
      monitor,
    });
    monitor.assertNoViolation();

    step.ok = true;
    step.duration_ms = Date.now() - startedAt;
    step.worker = publicWorker(settled.worker);
    step.handoff = publicHandoff(settled.handoff);
    step.realtime = monitor.publicSummary();
    step.durable_evidence = publicOutboxEvidence(evidence);
    console.log(
      `${isCompensation ? 'RESTORED' : 'OK'} ${index}/${total} in ${step.duration_ms}ms`
    );
    return settled;
  } catch (error) {
    step.ok = false;
    step.duration_ms = Date.now() - startedAt;
    step.error = errorMessage(error);
    if (monitor) step.realtime = monitor.publicSummary();
    if (afterOrder !== null) {
      step.durable_evidence = await safeHandoffEvidence({
        workerId: options.workerId,
        afterOrder,
        operationId,
        traceId,
      });
    }
    step.last_observation = await safeObservation();
    if (!isCompensation) {
      report.failures.push({
        step: index,
        from: transition.from.label,
        to: transition.to.label,
        error: step.error,
      });
    }
    console.error(`FAIL ${index}/${total}: ${step.error}`);
    throw error;
  } finally {
    await monitor?.close();
  }
}

async function safelyRestoreInitialProvider({
  initialOption,
  baselineIdentity,
  accountId,
}) {
  const compensation = {
    attempted: true,
    initial_provider: initialOption.label,
    outcome: 'pending',
    return_requested: false,
    steps: [],
  };
  const deadline = Date.now() + options.compensationTimeoutMs;
  const requestedReturnHandoffs = new Set();

  try {
    while (Date.now() < deadline) {
      const [current, handoff] = await Promise.all([
        readWorker(options.workerId),
        viewLatestHandoff(options.workerId),
      ]);
      const currentOption = optionForTypeId(current?.type?.id);

      if (
        isInitialProviderSafelyRestored({
          current,
          handoff,
          initialOption,
          baselineIdentity,
        })
      ) {
        compensation.outcome =
          compensation.steps.length > 0 || compensation.return_requested
            ? 'restored'
            : 'already_at_initial_provider';
        compensation.final_worker = publicWorker(current);
        compensation.final_handoff = publicHandoff(handoff);
        return compensation;
      }

      if (handoff && !isResolvedHandoff(handoff)) {
        const canRequestReturn =
          canRequestSafeHandoffReturn(handoff) &&
          !requestedReturnHandoffs.has(handoff.handoff_id);
        if (canRequestReturn) {
          requestedReturnHandoffs.add(handoff.handoff_id);
          await api(
            'POST',
            `/worker/${encodeURIComponent(options.workerId)}/provider-handoff/${encodeURIComponent(handoff.handoff_id)}/resolve`,
            { body: { action: 'return' } }
          );
          compensation.return_requested = true;
          compensation.return_handoff_id = handoff.handoff_id;
        }
        await delay(options.pollIntervalMs);
        continue;
      }

      if (!currentOption) {
        throw new Error(
          'Compensation cannot identify the current WhatsApp provider.'
        );
      }
      const currentErrors = workerHealthErrors(
        current,
        currentOption,
        baselineIdentity
      );
      if (currentErrors.length > 0) {
        await delay(options.pollIntervalMs);
        continue;
      }

      await runTransition({
        index: 1,
        total: 1,
        transition: { from: currentOption, to: initialOption },
        baselineIdentity,
        accountId,
        stepCollection: compensation.steps,
        isCompensation: true,
      });
    }
    throw new Error(
      `Compensation did not restore the initial provider within ${options.compensationTimeoutMs}ms.`
    );
  } catch (error) {
    compensation.outcome = 'failed';
    compensation.error = errorMessage(error);
    compensation.last_observation = await safeObservation();
    return compensation;
  }
}

export function canRequestSafeHandoffReturn(handoff) {
  return Boolean(
    handoff &&
    handoff.state === 'failed' &&
    handoff.source_revision_preserved === true &&
    handoff.can_return === true &&
    handoff.resolution_action == null &&
    typeof handoff.handoff_id === 'string' &&
    SAFE_EVENT_ID_PATTERN.test(handoff.handoff_id)
  );
}

export function isInitialProviderSafelyRestored({
  current,
  handoff,
  initialOption,
  baselineIdentity,
}) {
  return Boolean(
    optionForTypeId(current?.type?.id)?.id === initialOption?.id &&
    workerHealthErrors(current, initialOption, baselineIdentity).length === 0 &&
    (!handoff || isResolvedHandoff(handoff))
  );
}

async function waitForCooldown(worker, expectedOption, baselineIdentity) {
  const deadline = Date.now() + options.cooldownTimeoutMs;
  let lastAvailableAt = worker.recreate_available_at;

  while (Date.now() < deadline) {
    const availableAt = Date.parse(lastAvailableAt ?? '');
    if (!Number.isFinite(availableAt) || availableAt <= Date.now()) return;

    const remaining = Math.max(0, availableAt - Date.now());
    await delay(Math.min(options.pollIntervalMs, Math.max(250, remaining)));
    const current = await readWorker(options.workerId);
    assertHealthyWorker(current, expectedOption, baselineIdentity);
    assertNoUnresolvedHandoff(
      await viewLatestHandoff(options.workerId),
      'while waiting for recreate cooldown'
    );
    lastAvailableAt = current.recreate_available_at;
  }

  throw new Error(
    `Recreate cooldown did not expire within ${options.cooldownTimeoutMs}ms.`
  );
}

async function waitForSuccessfulHandoff({
  transition,
  baselineIdentity,
  startedAt,
  operationId,
  monitor,
}) {
  const deadline = Date.now() + options.handoffTimeoutMs;
  let lastWorker = null;
  let lastHandoff = null;

  while (Date.now() < deadline) {
    monitor.assertNoViolation();
    [lastWorker, lastHandoff] = await raceWithRealtimeViolation(
      Promise.all([
        readWorker(options.workerId),
        viewLatestHandoff(options.workerId),
      ]),
      monitor
    );

    const httpInteractiveEvidence = detectInteractiveLoginEvidence(
      lastWorker?.connection_status
    );
    if (httpInteractiveEvidence.length > 0) {
      monitor.recordHttpViolation(httpInteractiveEvidence);
      monitor.assertNoViolation();
    }

    if (
      isFailedHandoffForTarget(lastHandoff, transition.to, operationId) ||
      lastWorker?.status?.name === 'error'
    ) {
      throw new Error(
        `The handoff failed before completing: ${JSON.stringify({
          worker: publicWorker(lastWorker),
          handoff: publicHandoff(lastHandoff),
        })}`
      );
    }

    const workerHealthy =
      workerHealthErrors(lastWorker, transition.to, baselineIdentity).length ===
      0;
    const handoffCompleted = isCompletedHandoffForTarget(
      lastHandoff,
      transition.to,
      operationId
    );

    if (workerHealthy && handoffCompleted) {
      monitor.assertNoViolation();
      return { worker: lastWorker, handoff: lastHandoff };
    }

    await raceWithRealtimeViolation(delay(options.pollIntervalMs), monitor);
  }

  throw new Error(
    `The handoff did not complete within ${options.handoffTimeoutMs}ms: ${JSON.stringify(
      {
        elapsed_ms: Date.now() - startedAt,
        worker: publicWorker(lastWorker),
        handoff: publicHandoff(lastHandoff),
      }
    )}`
  );
}

async function readWorker(workerId) {
  const worker = await api('GET', `/worker/${encodeURIComponent(workerId)}`);
  if (!worker?.id) {
    throw new Error('Worker view did not include a worker id.');
  }
  return worker;
}

async function viewLatestHandoff(workerId) {
  return api(
    'GET',
    `/worker/${encodeURIComponent(workerId)}/provider-handoff/latest`
  );
}

async function viewHandoffEvidence(
  workerId,
  { afterOrder, operationId, traceId } = {}
) {
  const query = new URLSearchParams();
  if (afterOrder !== undefined && afterOrder !== null) {
    query.set('after_order', afterOrder);
  }
  if (operationId) query.set('operation_id', operationId);
  if (traceId) query.set('debug_trace_id', traceId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api(
    'GET',
    `/worker/${encodeURIComponent(workerId)}/provider-handoff/evidence${suffix}`
  );
}

export async function resolveAuthenticationToken(
  loginFn = login,
  { allowLogin = true } = {}
) {
  const configuredToken = process.env.HANDOFF_CANARY_TOKEN?.trim();
  if (configuredToken) return configuredToken;

  if (!allowLogin) {
    throw new Error('HANDOFF_CANARY_TOKEN is required for a GET-only dry-run.');
  }

  return loginFn();
}

async function login() {
  const login = requiredCredential('HANDOFF_CANARY_LOGIN', 'E2E_LOGIN');
  const password = requiredCredential(
    'HANDOFF_CANARY_PASSWORD',
    'E2E_PASSWORD'
  );
  const data = await api('POST', '/auth/login', {
    anonymous: true,
    body: { login, password },
    sessionPlatform: CANARY_LOGIN_SESSION_PLATFORM,
  });
  if (!data?.token || typeof data.token !== 'string') {
    throw new Error('Login did not return an access token.');
  }
  return data.token;
}

async function api(method, route, input = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.apiTimeoutMs);

  try {
    const headers = {
      'Accept-Language': 'pt',
    };
    if (input.sessionPlatform) {
      headers['X-Client-Platform'] = input.sessionPlatform;
    }
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!input.anonymous && token) headers.Authorization = `Bearer ${token}`;
    if (input.traceId) {
      headers['x-connection-lifecycle-debug-trace-id'] = input.traceId;
    }

    let response;
    try {
      response = await fetch(`${options.apiUrl}${route}`, {
        method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'timed out'
          : 'failed before receiving a response';
      throw new Error(`${method} ${route} ${reason}.`);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.status === false) {
      throw new Error(
        `${method} ${route} failed with HTTP ${response.status}.`
      );
    }
    return body?.data ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function detectInteractiveLoginEvidence(value) {
  if (!isRecord(value)) return [];
  const connectionStatus = isRecord(value.connection_status)
    ? value.connection_status
    : value;
  const evidence = new Set();

  for (const candidate of new Set([value, connectionStatus])) {
    if (nonEmptyString(candidate.qrcode)) evidence.add('qr_credential');
    if (candidate.qr_pending === true) evidence.add('qr_pending');
    if (candidate.is_new_login === true) evidence.add('new_login');
    if (nonEmptyString(candidate.pairing_code)) evidence.add('pairing_code');
    if (
      nonEmptyString(candidate.passkey_public_key) ||
      nonEmptyString(candidate.passkey_confirmation_code) ||
      candidate.passkey_pending === true
    ) {
      evidence.add('passkey');
    }

    const code = Number(candidate.code);
    if (Number.isSafeInteger(code) && INTERACTIVE_LOGIN_CODES.has(code)) {
      evidence.add(INTERACTIVE_LOGIN_CODES.get(code));
    }
  }
  const connectionStatusName = String(connectionStatus.status ?? '')
    .trim()
    .toLowerCase();
  if (
    connectionStatus.qrAvailable === true ||
    connectionStatusName === 'qr' ||
    connectionStatusName === 'qrcode' ||
    connectionStatusName === 'awaiting_qr'
  ) {
    evidence.add('qr_status');
  }
  if (
    connectionStatusName === 'awaiting_pairing_code' ||
    connectionStatusName === 'pairing_in_progress'
  ) {
    evidence.add('pairing_status');
  }
  if (
    connectionStatusName === 'awaiting_passkey' ||
    connectionStatusName === 'awaiting_passkey_confirmation'
  ) {
    evidence.add('passkey_status');
  }
  return [...evidence].sort();
}

export function publicApiUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return 'invalid_api_url';
  }
}

function safeCorrelationValue(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9_.:-]{1,128}$/u.test(normalized) ? normalized : null;
}

function safeCursor(value) {
  const normalized = typeof value === 'number' ? String(value) : value;
  return typeof normalized === 'string' && SAFE_CURSOR_PATTERN.test(normalized)
    ? normalized
    : null;
}

function compareDecimalCursors(left, right) {
  const normalizedLeft = safeCursor(left);
  const normalizedRight = safeCursor(right);
  if (!normalizedLeft || !normalizedRight) {
    throw new Error('Invalid durable outbox cursor.');
  }
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return normalizedLeft === normalizedRight
    ? 0
    : normalizedLeft < normalizedRight
      ? -1
      : 1;
}

export function centrifugoWebsocketUrl(value) {
  if (!nonEmptyString(value)) {
    throw new Error('Centrifugo auth response did not include a URL.');
  }
  const normalized = value.trim().replace(/\/+$/u, '');
  return normalized.endsWith('/connection/websocket')
    ? normalized
    : `${normalized}/connection/websocket`;
}

async function waitForCentrifugoConnected(client) {
  if (client.state === CentrifugeState.Connected) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off('connected', onConnected);
      client.off('disconnected', onDisconnected);
      client.off('error', onError);
      callback();
    };
    const onConnected = () => finish(resolve);
    const onDisconnected = () =>
      finish(() =>
        reject(new Error('Centrifugo disconnected before connecting.'))
      );
    const onError = () =>
      finish(() => reject(new Error('Centrifugo connection failed.')));
    const timer = setTimeout(
      () => finish(() => reject(new Error('Centrifugo connection timed out.'))),
      options.realtimeTimeoutMs
    );
    client.on('connected', onConnected);
    client.on('disconnected', onDisconnected);
    client.on('error', onError);
    client.connect();
  });
}

async function waitForCentrifugoSubscribed(subscription) {
  if (subscription.state === SubscriptionState.Subscribed) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.off('subscribed', onSubscribed);
      subscription.off('unsubscribed', onUnsubscribed);
      subscription.off('error', onError);
      callback();
    };
    const onSubscribed = () => finish(resolve);
    const onUnsubscribed = () =>
      finish(() =>
        reject(new Error('Centrifugo subscription closed before ready.'))
      );
    const onError = () =>
      finish(() => reject(new Error('Centrifugo subscription failed.')));
    const timer = setTimeout(
      () =>
        finish(() => reject(new Error('Centrifugo subscription timed out.'))),
      options.realtimeTimeoutMs
    );
    subscription.on('subscribed', onSubscribed);
    subscription.on('unsubscribed', onUnsubscribed);
    subscription.on('error', onError);
    subscription.subscribe();
  });
}

async function createRealtimeTransitionMonitor({ accountId, workerId }) {
  const realtimeAuth = await api('POST', '/centrifugo/auth/token', {
    body: {},
  });
  if (!nonEmptyString(realtimeAuth?.token)) {
    throw new Error('Centrifugo auth response did not include a token.');
  }

  const channel = `worker:account#${accountId}`;
  const client = new Centrifuge(centrifugoWebsocketUrl(realtimeAuth.url), {
    websocket: WebSocket,
    token: realtimeAuth.token,
    timeout: options.realtimeTimeoutMs,
    maxServerPingDelay: 60_000,
    minReconnectDelay: 500,
    maxReconnectDelay: 5_000,
  });
  const subscription = client.newSubscription(channel, { recoverable: true });
  const markers = [];
  let afterOrder = null;
  let expectedOperationId = null;
  let expectedTraceId = null;
  let violation = null;
  let resolveViolation;
  let lastStreamOffset = null;
  let lastOutboxOrder = null;
  let firstOutboxOrder = null;
  let streamGapDetected = false;
  let recoveryFailed = false;
  let disconnectedCount = 0;
  let relevantEventCount = 0;
  let outboxEventCount = 0;
  const violationSignal = new Promise((resolve) => {
    resolveViolation = resolve;
  });

  const setViolation = (source, evidence) => {
    if (violation || evidence.length === 0) return;
    violation = { source, evidence: [...new Set(evidence)].sort() };
    resolveViolation(violation);
  };
  const onPublication = (context) => {
    const streamOffset = Number(context?.offset);
    if (Number.isSafeInteger(streamOffset) && streamOffset > 0) {
      if (lastStreamOffset !== null && streamOffset !== lastStreamOffset + 1) {
        streamGapDetected = true;
      }
      lastStreamOffset = streamOffset;
    }

    const payload = context?.data;
    if (
      !isRecord(payload) ||
      payload.worker_id !== workerId ||
      payload.account_id !== accountId
    ) {
      return;
    }
    relevantEventCount += 1;
    const outboxOrder = safeCursor(payload.connection_status_order);
    if (outboxOrder) {
      outboxEventCount += 1;
      if (
        lastOutboxOrder &&
        compareDecimalCursors(outboxOrder, lastOutboxOrder) <= 0
      ) {
        streamGapDetected = true;
      }
      firstOutboxOrder ??= outboxOrder;
      lastOutboxOrder = outboxOrder;
    }
    const marker = {
      operationId: safeCorrelationValue(
        payload.lifecycle_operation_id ?? payload.operation_id
      ),
      traceId: safeCorrelationValue(payload.debug_trace_id),
      eventId:
        typeof payload.event_id === 'string' &&
        SAFE_EVENT_ID_PATTERN.test(payload.event_id)
          ? payload.event_id
          : null,
      outboxOrder,
    };
    markers.push(marker);
    if (markers.length > 10_000) markers.shift();

    const evidence = detectInteractiveLoginEvidence(payload);
    if (evidence.length > 0) setViolation('realtime', evidence);
  };
  const onSubscribed = (context) => {
    if (context?.wasRecovering === true && context?.recovered !== true) {
      recoveryFailed = true;
    }
  };
  const onDisconnected = () => {
    disconnectedCount += 1;
  };

  subscription.on('publication', onPublication);
  subscription.on('subscribed', onSubscribed);
  client.on('disconnected', onDisconnected);

  try {
    await waitForCentrifugoConnected(client);
    await waitForCentrifugoSubscribed(subscription);
  } catch (error) {
    subscription.off('publication', onPublication);
    subscription.off('subscribed', onSubscribed);
    client.off('disconnected', onDisconnected);
    try {
      subscription.unsubscribe();
    } catch {}
    try {
      client.disconnect();
    } catch {}
    throw error;
  }

  return {
    setAfterOrder(value) {
      afterOrder = safeCursor(value);
      if (!afterOrder) throw new Error('Invalid realtime baseline cursor.');
    },
    setExpectedCorrelation({ operationId, traceId }) {
      if (operationId) expectedOperationId = safeCorrelationValue(operationId);
      if (traceId) expectedTraceId = safeCorrelationValue(traceId);
    },
    recordHttpViolation(evidence) {
      setViolation('http', evidence);
    },
    assertNoViolation() {
      if (!violation) return;
      throw new Error(
        `Interactive login evidence detected (${violation.source}:${violation.evidence.join(',')}).`
      );
    },
    waitForViolation() {
      return violationSignal;
    },
    publicSummary() {
      const correlatedEventCount = markers.filter(
        (marker) =>
          (expectedOperationId && marker.operationId === expectedOperationId) ||
          (expectedTraceId && marker.traceId === expectedTraceId)
      ).length;
      return {
        subscribed_before_patch: true,
        relevant_event_count: relevantEventCount,
        outbox_event_count: outboxEventCount,
        correlated_event_count: correlatedEventCount,
        after_order: afterOrder,
        first_outbox_order: firstOutboxOrder,
        last_outbox_order: lastOutboxOrder,
        stream_gap_detected: streamGapDetected,
        recovery_failed: recoveryFailed,
        disconnected_count: disconnectedCount,
        interactive_login_detected: Boolean(violation),
        interactive_login_source: violation?.source ?? null,
        interactive_login_evidence: violation?.evidence ?? [],
      };
    },
    async close() {
      subscription.off('publication', onPublication);
      subscription.off('subscribed', onSubscribed);
      client.off('disconnected', onDisconnected);
      try {
        if (subscription.state !== SubscriptionState.Unsubscribed) {
          subscription.unsubscribe();
        }
      } catch {}
      try {
        client.disconnect();
      } catch {}
    },
  };
}

async function raceWithRealtimeViolation(promise, monitor) {
  return Promise.race([
    promise,
    monitor.waitForViolation().then(() => {
      monitor.assertNoViolation();
      throw new Error('Interactive login evidence detected.');
    }),
  ]);
}

function assertEvidenceBaseline(evidence) {
  if (!isRecord(evidence)) {
    throw new Error('Durable outbox baseline is unavailable.');
  }
  if (evidence.after_order !== null) {
    throw new Error('Durable outbox baseline unexpectedly contained a window.');
  }
  const cursor = evidence.observed_through_order ?? '0';
  if (!safeCursor(cursor)) {
    throw new Error('Durable outbox baseline cursor is invalid.');
  }
  return cursor;
}

function durableEvidenceErrors(evidence, afterOrder) {
  const errors = [];
  if (!isRecord(evidence)) return ['durable evidence is unavailable'];
  if (evidence.after_order !== afterOrder) {
    errors.push('durable evidence baseline does not match');
  }
  const observedThrough = safeCursor(evidence.observed_through_order);
  const firstOrder = safeCursor(evidence.first_window_order);
  const lastOrder = safeCursor(evidence.last_window_order);
  if (
    !observedThrough ||
    compareDecimalCursors(observedThrough, afterOrder) <= 0
  ) {
    errors.push('durable outbox cursor did not advance');
  }
  if (!firstOrder || compareDecimalCursors(firstOrder, afterOrder) <= 0) {
    errors.push('first durable event is outside the transition window');
  }
  if (
    !lastOrder ||
    compareDecimalCursors(lastOrder, afterOrder) <= 0 ||
    (observedThrough && compareDecimalCursors(lastOrder, observedThrough) > 0)
  ) {
    errors.push('last durable event is outside the observed cursor');
  }
  if (
    !Number.isSafeInteger(evidence.window_event_count) ||
    evidence.window_event_count <= 0
  ) {
    errors.push('durable transition window is empty');
  }
  if (
    !Number.isSafeInteger(evidence.correlated_event_count) ||
    evidence.correlated_event_count <= 0
  ) {
    errors.push('durable outbox has no event correlated to this operation');
  }
  if (evidence.window_truncated === true) {
    errors.push('durable transition window exceeded its safety limit');
  }
  if (
    evidence.interactive_login_detected === true ||
    Number(evidence.interactive_login_event_count) > 0 ||
    Number(evidence.qr_event_count) > 0 ||
    Number(evidence.pairing_event_count) > 0 ||
    Number(evidence.passkey_event_count) > 0
  ) {
    errors.push('durable outbox contains interactive login evidence');
  }
  return errors;
}

export function assertDurableHandoffEvidence(evidence, afterOrder) {
  const normalizedAfterOrder = safeCursor(afterOrder);
  if (!normalizedAfterOrder) {
    throw new Error('Invalid durable evidence baseline cursor.');
  }
  const errors = durableEvidenceErrors(evidence, normalizedAfterOrder);
  if (errors.length > 0) {
    throw new Error(`Durable handoff evidence failed: ${errors.join('; ')}.`);
  }
}

async function waitForDurableEvidence({
  workerId,
  afterOrder,
  operationId,
  traceId,
  monitor,
}) {
  const deadline = Date.now() + Math.min(60_000, options.handoffTimeoutMs);
  let lastEvidence = null;
  let lastErrors = ['durable evidence was not read'];
  while (Date.now() < deadline) {
    monitor.assertNoViolation();
    lastEvidence = await raceWithRealtimeViolation(
      viewHandoffEvidence(workerId, {
        afterOrder,
        operationId,
        traceId,
      }),
      monitor
    );
    lastErrors = durableEvidenceErrors(lastEvidence, afterOrder);
    const terminalEvidenceFailure = lastErrors.some(
      (error) =>
        error.includes('interactive login') || error.includes('safety limit')
    );
    if (lastErrors.length === 0) return lastEvidence;
    if (terminalEvidenceFailure) break;
    await raceWithRealtimeViolation(delay(options.pollIntervalMs), monitor);
  }
  throw new Error(`Durable handoff evidence failed: ${lastErrors.join('; ')}.`);
}

function publicOutboxEvidence(evidence) {
  if (!isRecord(evidence)) return null;
  return {
    after_order: safeCursor(evidence.after_order),
    observed_through_order: safeCursor(evidence.observed_through_order),
    first_window_order: safeCursor(evidence.first_window_order),
    last_window_order: safeCursor(evidence.last_window_order),
    window_event_count: Number(evidence.window_event_count) || 0,
    operation_event_count: Number(evidence.operation_event_count) || 0,
    trace_event_count: Number(evidence.trace_event_count) || 0,
    correlated_event_count: Number(evidence.correlated_event_count) || 0,
    pending_event_count: Number(evidence.pending_event_count) || 0,
    dead_letter_event_count: Number(evidence.dead_letter_event_count) || 0,
    qr_event_count: Number(evidence.qr_event_count) || 0,
    pairing_event_count: Number(evidence.pairing_event_count) || 0,
    passkey_event_count: Number(evidence.passkey_event_count) || 0,
    interactive_login_event_count:
      Number(evidence.interactive_login_event_count) || 0,
    interactive_login_detected: evidence.interactive_login_detected === true,
    window_limit: Number(evidence.window_limit) || 0,
    window_truncated: evidence.window_truncated === true,
  };
}

async function safeHandoffEvidence({
  workerId,
  afterOrder,
  operationId,
  traceId,
}) {
  try {
    return publicOutboxEvidence(
      await viewHandoffEvidence(workerId, {
        afterOrder,
        operationId,
        traceId,
      })
    );
  } catch (error) {
    return { unavailable: errorMessage(error) };
  }
}

function assertInitialWorker(worker) {
  const initialOption = optionForTypeId(worker?.type?.id);
  if (!initialOption) {
    throw new Error('The channel does not use a supported WhatsApp option.');
  }
  assertHealthyWorker(worker, initialOption, {
    workerId: options.workerId,
    number: worker?.number,
  });
  return initialOption;
}

function assertHealthyWorker(worker, expectedOption, baselineIdentity) {
  const errors = workerHealthErrors(worker, expectedOption, baselineIdentity);
  if (errors.length > 0) {
    throw new Error(`Worker is not safely online: ${errors.join('; ')}`);
  }
}

export function workerHealthErrors(worker, expectedOption, baselineIdentity) {
  const connection = worker?.connection_status;
  const errors = [];

  if (!worker) {
    errors.push('worker view is empty');
    return errors;
  }
  if (worker.id !== baselineIdentity.workerId) errors.push('worker id changed');
  if (worker.session_storage !== 'postgres') {
    errors.push('session storage is not postgres');
  }
  if (worker.type?.id !== expectedOption.id) {
    errors.push(`expected ${expectedOption.label}`);
  }
  if (worker.status?.name !== 'online')
    errors.push('worker status is not online');
  if (worker.lifecycle_operation_id) {
    errors.push('lifecycle operation is still active');
  }
  if (worker.connection_online_acknowledged !== true) {
    errors.push('native online status was not acknowledged');
  }
  // The public API exposes no raw session row. These fields are the normal
  // API proof that the persisted session is ready and was not replaced by QR.
  if (connection?.provider !== expectedOption.provider) {
    errors.push('native provider does not match the target option');
  }
  if (connection?.status !== 'online') {
    errors.push('native connection status is not online');
  }
  if (connection?.connected !== true)
    errors.push('native connection is closed');
  if (connection?.authenticated !== true) {
    errors.push('persisted session is not authenticated');
  }
  if (connection?.sessionValid !== true) {
    errors.push('persisted session is not valid');
  }
  if (connection?.qrAvailable !== false) {
    errors.push('a new QR session was requested');
  }
  if (!worker.number) errors.push('connected number is absent');
  if (baselineIdentity.number && worker.number !== baselineIdentity.number) {
    errors.push('connected number changed');
  }

  return errors;
}

function assertNoUnresolvedHandoff(handoff, context) {
  if (!handoff) return;
  if (!isResolvedHandoff(handoff)) {
    throw new Error(
      `An unresolved provider handoff exists ${context}: ${JSON.stringify(
        publicHandoff(handoff)
      )}`
    );
  }
}

export function isResolvedHandoff(handoff) {
  return Boolean(
    isCompletedHandoff(handoff) ||
    (handoff &&
      handoff.state === 'failed' &&
      handoff.source_revision_preserved === true &&
      handoff.source_runtime_restored === true &&
      !ACTIVE_RECOVERY_STATES.has(handoff.recovery_state) &&
      handoff.resolution_required !== true &&
      handoff.resolution_state === 'completed')
  );
}

function assertCompletedHandoff(handoff, expectedOption, context) {
  if (!isCompletedHandoffForTarget(handoff, expectedOption)) {
    throw new Error(
      `Expected a completed handoff to ${expectedOption.label} ${context}: ${JSON.stringify(
        publicHandoff(handoff)
      )}`
    );
  }
}

function isCompletedHandoffForTarget(
  handoff,
  expectedOption,
  expectedOperationId
) {
  return (
    isCompletedHandoff(handoff) &&
    handoff.target_provider === expectedOption.provider &&
    (!expectedOperationId ||
      handoffMatchesOperation(handoff, expectedOperationId))
  );
}

function isCompletedHandoff(handoff) {
  return Boolean(
    handoff &&
    handoff.state === 'completed' &&
    !ACTIVE_RECOVERY_STATES.has(handoff.recovery_state) &&
    handoff.resolution_required !== true &&
    handoff.resolution_state !== 'running'
  );
}

function isFailedHandoffForTarget(
  handoff,
  expectedOption,
  expectedOperationId
) {
  return Boolean(
    handoff &&
    handoff.target_provider === expectedOption.provider &&
    (!expectedOperationId ||
      handoffMatchesOperation(handoff, expectedOperationId)) &&
    handoff.state === 'failed'
  );
}

export function handoffMatchesOperation(handoff, operationId) {
  if (typeof operationId !== 'string' || operationId.length === 0) return false;
  return (
    handoff?.handoff_lifecycle_operation_id === operationId ||
    handoff?.lifecycle_operation_id === operationId
  );
}

async function safeObservation() {
  const [workerResult, handoffResult] = await Promise.allSettled([
    readWorker(options.workerId),
    viewLatestHandoff(options.workerId),
  ]);
  return {
    worker:
      workerResult.status === 'fulfilled'
        ? publicWorker(workerResult.value)
        : { unavailable: errorMessage(workerResult.reason) },
    handoff:
      handoffResult.status === 'fulfilled'
        ? publicHandoff(handoffResult.value)
        : { unavailable: errorMessage(handoffResult.reason) },
  };
}

function publicWorker(worker) {
  if (!worker) return null;
  const connection = worker.connection_status;
  return {
    id: worker.id ?? null,
    session_storage: worker.session_storage ?? null,
    option: optionLabelForTypeId(worker.type?.id),
    status: worker.status?.name ?? null,
    number_present: nonEmptyString(worker.number),
    lifecycle_operation_active: Boolean(worker.lifecycle_operation_id),
    connection_online_acknowledged:
      worker.connection_online_acknowledged === true,
    connection: connection
      ? {
          status: connection.status ?? null,
          connected: connection.connected === true,
          authenticated: connection.authenticated === true,
          session_valid: connection.sessionValid === true,
          qr_available: connection.qrAvailable === true,
          sequence: connection.sequence ?? null,
        }
      : null,
  };
}

function publicHandoff(handoff) {
  if (!handoff) return null;
  return {
    handoff_id:
      typeof handoff.handoff_id === 'string' &&
      SAFE_EVENT_ID_PATTERN.test(handoff.handoff_id)
        ? handoff.handoff_id
        : null,
    operation_id: publicOperationId(
      handoff.handoff_lifecycle_operation_id ?? handoff.lifecycle_operation_id
    ),
    state: handoff.state ?? null,
    source: optionLabelForProvider(handoff.source_provider),
    target: optionLabelForProvider(handoff.target_provider),
    recovery_state: handoff.recovery_state ?? null,
    recovery_error_code: handoff.recovery_error_code ?? null,
    resolution_required: handoff.resolution_required === true,
    resolution_state: handoff.resolution_state ?? null,
  };
}

function optionLabelForTypeId(typeId) {
  return optionForTypeId(typeId)?.label ?? 'Opção desconhecida';
}

function optionForTypeId(typeId) {
  return Object.values(WHATSAPP_OPTIONS).find((option) => option.id === typeId);
}

function optionLabelForProvider(provider) {
  return (
    Object.values(WHATSAPP_OPTIONS).find(
      (option) => option.provider === provider
    )?.label ?? 'Opção desconhecida'
  );
}

function publicOperationId(operationId) {
  return typeof operationId === 'string' &&
    SAFE_EVENT_ID_PATTERN.test(operationId)
    ? operationId
    : null;
}

function publicTraceId(traceId) {
  return safeCorrelationValue(traceId);
}

function requiredCredential(primary, fallback) {
  const value = process.env[primary]?.trim() || process.env[fallback]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${primary} or ${fallback} in the selected environment.`
    );
  }
  return value;
}

function optionValue(name) {
  const equalsPrefix = `${name}=`;
  const equals = args.find((argument) => argument.startsWith(equalsPrefix));
  if (equals) return equals.slice(equalsPrefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

function positiveIntegerOption(name, fallback) {
  const raw = optionValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function finish(error) {
  if (error) {
    report.outcome = 'failed';
    report.failures.push({ step: 'main', error: errorMessage(error) });
  }
  report.finished_at = new Date().toISOString();
  report.duration_ms =
    Date.parse(report.finished_at) - Date.parse(report.started_at);

  await mkdir(options.reportDirectory, { recursive: true });
  const stamp = report.finished_at.replace(/[-:.TZ]/g, '').slice(0, 17);
  const file = path.join(
    options.reportDirectory,
    `whatsapp-provider-handoff-live-canary-${options.workerId}-${stamp}.json`
  );
  report.report_file = path.relative(ROOT, file);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`REPORT ${report.report_file}`);

  if (error) {
    console.error(`CANARY FAILED: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main()
    .then((shouldWriteReport) => {
      if (shouldWriteReport !== false) return finish();
      return undefined;
    })
    .catch(finish);
}
