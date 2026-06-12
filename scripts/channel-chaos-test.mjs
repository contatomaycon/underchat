import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import Redis from 'ioredis';
import pg from 'pg';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WORKER_STATUS = {
  online: '019a930d-c6f6-766d-9c84-30af6ecc33b2',
  offline: '019a930d-c6f6-766d-9c84-3696c2cd5ed8',
  disponible: '019a930d-c6f6-766d-9c84-3904383fe742',
  creating: '019a930d-c6f6-766d-9c84-52e87789979b',
  recreating: '019a930d-c6f6-766d-9c84-46093814d8e0',
  error: '019a930d-c6f6-766d-9c84-48cb970a9f21',
  mismatched: '019a930d-c6f6-766d-9c84-5056ccf66633',
  stopped: '019bcd18-ce66-77a2-9d7c-e48159c253da',
};

const READY_STATUS_IDS = new Set([
  WORKER_STATUS.disponible,
  WORKER_STATUS.offline,
  WORKER_STATUS.mismatched,
]);

const QR_REQUESTABLE_STATUS_IDS = new Set([
  WORKER_STATUS.disponible,
  WORKER_STATUS.creating,
  WORKER_STATUS.recreating,
]);

const WORKER_TYPES = [
  {
    key: 'baileys',
    label: 'Opcao 1 (Socket)',
    id: '019a930d-c6f6-766d-9c84-53307d4159a1',
  },
  {
    key: 'wwebjs',
    label: 'Opcao 2 (Navegador)',
    id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
  },
  {
    key: 'whatsmeow',
    label: 'Opcao 3 (Socket)',
    id: 'e80ad183-2b46-4628-9105-a036f2d28720',
  },
];
const KNOWN_CONNECTED_BAILEYS_TARGET = {
  worker_id: '019eb9ce-1511-76db-b4dc-f7ce980705a9',
  name: 'Baileys',
  number: '556192037138',
};

const KNOWN_STRESS_ACCOUNTS = [
  {
    key: 'teste',
    account_id: '019d01bc-8355-7058-bfe1-7bce42a78dc6',
    name: 'Teste',
  },
  {
    key: 'underchat',
    account_id: '019a930d-c6f4-75ad-88ff-8d2fcd5839e1',
    name: 'Underchat',
  },
];

const args = new Set(process.argv.slice(2));
const keepChannels = args.has('--keep');
const includeTargetChannel =
  args.has('--target-channel') || Boolean(valueArg('--target-worker-id'));
const skipDefaultChaos = args.has('--skip-default-chaos');
const cycles = numberArg('--cycles', 3);
const stressWorkers = numberArg(
  '--stress-workers',
  args.has('--stress') ? 6 : 0
);
const qrBurstSize = numberArg('--qr-burst-size', 6);
const includeMultiAccountStress =
  !args.has('--skip-multi-account-stress') &&
  (args.has('--multi-account-stress') || stressWorkers > 0);
const multiAccountWorkersPerType = numberArg(
  '--multi-account-workers-per-type',
  args.has('--stress') ? 2 : 1
);
const multiAccountQrBurstSize = numberArg(
  '--multi-account-qr-burst-size',
  qrBurstSize
);
const readyTimeoutMs = numberArg('--ready-timeout-ms', 180_000);
const qrTimeoutMs = numberArg('--qr-timeout-ms', 90_000);
const apiTimeoutMs = numberArg('--api-timeout-ms', 35_000);
const targetOnlineTimeoutMs = numberArg('--target-online-timeout-ms', 180_000);
const targetCooldownWaitMs = numberArg('--target-cooldown-wait-ms', 120_000);
const stamp = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, '')
  .slice(0, 14);
const baseName = valueArg('--base-name') ?? `codex-chaos-${stamp}`;

const apiUrl = normalizeBaseUrl(
  valueArg('--api-url') ?? process.env.E2E_API_URL ?? 'http://localhost:3002/v1'
);

const report = {
  started_at: new Date().toISOString(),
  api_url: apiUrl,
  base_name: baseName,
  keep_channels: keepChannels,
  cycles,
  steps: [],
  created_workers: [],
  deleted_workers: [],
  failures: [],
  target_channel: null,
  stress: null,
  multi_account_stress: null,
  account_contexts: [],
  remote_logs: {},
};

let token = '';
let loginData = null;
let defaultAuthContext = null;
const workerAuthContexts = new Map();

const pool = new Pool({
  host: requiredDbEnv('HOST'),
  port: Number(requiredDbEnv('PORT')),
  user: requiredDbEnv('USER'),
  password: requiredDbEnv('PASSWORD'),
  database: requiredDbEnv('DATABASE'),
  ssl:
    (process.env.E2E_DB_SSLMODE ?? process.env.DB_SSLMODE) === 'true'
      ? { rejectUnauthorized: false }
      : false,
});

const redis = new Redis({
  host: requiredEnv('DB_CACHE_HOST'),
  port: Number(requiredEnv('DB_CACHE_PORT')),
  password: process.env.DB_CACHE_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

process.on('SIGINT', async () => {
  report.failures.push({ step: 'sigint', error: 'Interrupted by SIGINT' });
  await cleanupAndExit(130);
});

await main().catch(async (error) => {
  report.failures.push({ step: 'main', error: errorMessage(error) });
  console.error(`FAIL ${errorMessage(error)}`);
  await collectFailureContext();
  await cleanupAndExit(1);
});

async function main() {
  await redis.connect();
  loginData = await login();
  token = loginData.token;
  defaultAuthContext = buildAuthContextFromLogin(loginData, 'login');
  report.account_contexts.push(publicAuthContext(defaultAuthContext));

  await step('preflight', async () => {
    let servers = null;
    let workerServersError = null;
    try {
      servers = await api('GET', '/worker/servers');
    } catch (error) {
      workerServersError = errorMessage(error);
    }

    return {
      api_ok: true,
      redis_ping: await redis.ping(),
      worker_servers: servers?.results?.map((server) => ({
        id: server.server_id,
        name: server.name,
        status: server.status,
      })),
      worker_servers_error: workerServersError,
    };
  });

  if (includeTargetChannel) {
    await runTargetChannelScenario();
  }

  if (!skipDefaultChaos) {
    for (const type of WORKER_TYPES) {
      await createChannelAndQr(type, `${baseName}-${type.key}`);
    }

    const mainWorker = report.created_workers[0];
    if (!mainWorker) {
      throw new Error('No worker was created for chaos scenarios.');
    }

    await recreateAndQr(
      mainWorker.worker_id,
      mainWorker.name,
      mainWorker.type,
      {
        index: 0,
        route: 'worker-cooldown',
      }
    );

    for (let index = 1; index <= cycles; index += 1) {
      await recreateAndQr(
        mainWorker.worker_id,
        mainWorker.name,
        mainWorker.type,
        {
          index,
          route: 'reset',
        }
      );
    }

    const switchSequence = [
      WORKER_TYPES[1],
      WORKER_TYPES[2],
      WORKER_TYPES[0],
      WORKER_TYPES[2],
      WORKER_TYPES[1],
      WORKER_TYPES[0],
    ];

    for (const [index, type] of switchSequence.entries()) {
      await switchTypeAndQr(
        mainWorker.worker_id,
        mainWorker.name,
        type,
        index + 1
      );
    }
  }

  if (stressWorkers > 0) {
    await runStressScenario(stressWorkers);
  }

  if (includeMultiAccountStress) {
    await runMultiAccountStressScenario();
  }

  await collectRemoteLogsForCreatedWorkers();
  await cleanupAndExit(0);
}

async function runTargetChannelScenario() {
  const workerId =
    valueArg('--target-worker-id') ?? KNOWN_CONNECTED_BAILEYS_TARGET.worker_id;
  const workerName =
    valueArg('--target-worker-name') ?? KNOWN_CONNECTED_BAILEYS_TARGET.name;
  const targetStartedAt = new Date().toISOString();

  report.target_channel = {
    worker_id: workerId,
    requested_name: workerName,
    started_at: targetStartedAt,
    steps: [],
  };

  const before = await step('target:before', async () => {
    const worker = await readWorker(workerId);
    if (!worker) {
      throw new Error(`Target worker ${workerId} was not found`);
    }

    const type = workerTypeById(worker.worker_type_id);
    if (!type) {
      throw new Error(`Target worker ${workerId} has unknown type`);
    }

    return compactWorker(worker);
  });
  report.target_channel.before = before;

  await waitForRecreateCooldown(workerId);

  const recreateTraceId = trace('target-recreate', workerId);
  const recreateResult = await step(
    'target:recreate:preserve-session',
    async () => {
      const startedAt = Date.now();
      const beforeWorker = await readWorker(workerId);
      const type = workerTypeById(beforeWorker?.worker_type_id);
      if (!beforeWorker || !type) {
        throw new Error(
          `Target worker ${workerId} disappeared before recreate`
        );
      }

      const data = await api(
        'PATCH',
        `/worker/${encodeURIComponent(workerId)}`,
        {
          traceId: recreateTraceId,
          timeoutMs: apiTimeoutMs,
          allowHttpStatuses: [200, 202, 409],
        }
      );

      if (data.__http_status === 409) {
        throw new Error(
          `Target recreate is still in cooldown: ${data.message ?? 'cooldown'}`
        );
      }

      const online = await waitForOnlineAfterRecreate(
        workerId,
        type,
        beforeWorker,
        data.operation_id
      );

      return {
        worker_id: workerId,
        type: type.key,
        operation_id: data.operation_id,
        debug_trace_id: data.debug_trace_id ?? recreateTraceId,
        online_ms: Date.now() - startedAt,
        before: compactWorker(beforeWorker),
        after: online,
        runtime_generation_advanced:
          Number(online.runtime_generation ?? 0) >
          Number(beforeWorker.runtime_generation ?? 0),
        container_changed:
          Boolean(beforeWorker.container_id) &&
          Boolean(online.container_id) &&
          beforeWorker.container_id !== online.container_id,
      };
    }
  );

  report.target_channel.recreate = recreateResult;

  const beforeSwitch = await readWorker(workerId);
  const browserType = workerTypeByKey('wwebjs');
  const switchTraceId = trace('target-switch', workerId);
  const switchResult = await step('target:switch:wwebjs', async () => {
    if (!beforeSwitch) {
      throw new Error(`Target worker ${workerId} was not found before switch`);
    }

    const startedAt = Date.now();
    const data = await api(
      'PATCH',
      `/worker/${encodeURIComponent(workerId)}/${encodeURIComponent(
        beforeSwitch.name ?? workerName
      )}`,
      {
        body: { worker_type: browserType.id },
        traceId: switchTraceId,
        timeoutMs: apiTimeoutMs,
      }
    );

    const ready = await waitForReady(workerId, browserType);
    const after = await readWorker(workerId);
    const oldSessionInvalidated = Boolean(
      after &&
      after.worker_type_id === browserType.id &&
      after.number === null &&
      after.connection_date === null &&
      (after.session_volume_name !== beforeSwitch.session_volume_name ||
        after.runtime_generation !== beforeSwitch.runtime_generation)
    );

    return {
      worker_id: workerId,
      operation_id: data.operation_id,
      lifecycle_queued: data.queued === true,
      debug_trace_id: data.debug_trace_id ?? switchTraceId,
      ready_ms: Date.now() - startedAt,
      before: compactWorker(beforeSwitch),
      ready,
      after: compactWorker(after),
      old_session_invalidated: oldSessionInvalidated,
    };
  });

  report.target_channel.switch_to_wwebjs = switchResult;
  const qrResult = await requestQrAndWait(
    workerId,
    browserType,
    'target:switch:wwebjs'
  );
  report.target_channel.switch_qr = qrResult;

  await collectTargetRemoteLogs(workerId, targetStartedAt);
}

async function createChannelAndQr(type, name, context = defaultAuthContext) {
  const response = await createChannel(
    type,
    name,
    `create:${type.key}`,
    context
  );
  await requestQrAndWait(
    response.worker_id,
    type,
    `create:${type.key}`,
    context
  );
}

async function createChannel(type, name, label, context = defaultAuthContext) {
  const traceId = trace('create', type.key);
  return step(label, async () => {
    const startedAt = Date.now();
    const data = await api('POST', '/worker', {
      body: {
        name,
        worker_type: type.id,
      },
      traceId,
      context,
      timeoutMs: apiTimeoutMs,
    });
    const workerId = data.worker_id;
    workerAuthContexts.set(workerId, context);
    report.created_workers.push({
      worker_id: workerId,
      name,
      type: type.key,
      type_id: type.id,
      account_id: context?.account_id,
      account_name: context?.account_name,
      debug_trace_id: data.debug_trace_id ?? traceId,
    });

    const ready = await waitForReady(workerId, type);
    return {
      worker_id: workerId,
      name,
      type: type.key,
      account_id: context?.account_id,
      account_name: context?.account_name,
      ack_reason: data.reason,
      warm_pool_claimed: data.warm_pool_claimed === true,
      fallback_created: data.fallback_created === true,
      operation_id: data.operation_id,
      debug_trace_id: data.debug_trace_id ?? traceId,
      ready_ms: Date.now() - startedAt,
      ready,
    };
  });
}

async function recreateAndQr(
  workerId,
  name,
  typeKey,
  options,
  context = defaultAuthContext
) {
  const current = await readWorker(workerId);
  const type = WORKER_TYPES.find((item) => item.id === current?.worker_type_id);
  if (!type) {
    throw new Error(`Unknown current type for worker ${workerId}`);
  }

  const traceId = trace('recreate', `${options.index}-${type.key}`);
  const recreateResult = await step(
    `recreate:${options.index}:${options.route}`,
    async () => {
      const startedAt = Date.now();
      let data;
      if (options.route === 'worker-cooldown') {
        data = await api('PATCH', `/worker/${encodeURIComponent(workerId)}`, {
          traceId,
          context,
          timeoutMs: apiTimeoutMs,
          allowHttpStatuses: [202, 409],
        });

        if (data.__http_status === 409) {
          return {
            worker_id: workerId,
            type: type.key,
            route: options.route,
            cooldown_confirmed: true,
            message: data.message,
            recreate_available_at: data.data?.recreate_available_at,
          };
        }
      } else if (options.route === 'reset') {
        data = await api(
          'POST',
          `/worker/${encodeURIComponent(workerId)}/connection/reset`,
          {
            body: {},
            traceId,
            context,
            timeoutMs: apiTimeoutMs,
          }
        );
      } else {
        data = await api('PATCH', `/worker/${encodeURIComponent(workerId)}`, {
          traceId,
          context,
          timeoutMs: apiTimeoutMs,
        });
      }

      const ready = await waitForReady(workerId, type);
      return {
        worker_id: workerId,
        name,
        type: type.key,
        account_id: context?.account_id,
        account_name: context?.account_name,
        route: options.route,
        operation_id: data.operation_id,
        debug_trace_id: data.debug_trace_id ?? traceId,
        ready_ms: Date.now() - startedAt,
        ready,
      };
    }
  );

  const qr = await requestQrAndWait(
    workerId,
    type,
    `recreate:${options.index}`,
    context
  );
  return { ...recreateResult, qr };
}

async function switchTypeAndQr(
  workerId,
  name,
  type,
  index,
  context = defaultAuthContext
) {
  const traceId = trace('switch', `${index}-${type.key}`);
  const switchResult = await step(`switch:${index}:${type.key}`, async () => {
    const startedAt = Date.now();
    const data = await api(
      'PATCH',
      `/worker/${encodeURIComponent(workerId)}/${encodeURIComponent(name)}`,
      {
        body: { worker_type: type.id },
        traceId,
        context,
        timeoutMs: apiTimeoutMs,
      }
    );
    const ready = await waitForReady(workerId, type);
    return {
      worker_id: workerId,
      name,
      type: type.key,
      account_id: context?.account_id,
      account_name: context?.account_name,
      operation_id: data?.operation_id,
      lifecycle_queued: data?.queued === true,
      debug_trace_id: data?.debug_trace_id ?? traceId,
      ready_ms: Date.now() - startedAt,
      ready,
    };
  });

  const qr = await requestQrAndWait(
    workerId,
    type,
    `switch:${index}:${type.key}`,
    context
  );
  return { ...switchResult, qr };
}

async function requestQrAndWait(
  workerId,
  type,
  label,
  context = defaultAuthContext
) {
  const traceId = trace('qr', `${label}-${type.key}`.replaceAll(':', '-'));
  return step(`qr:${label}`, async () => {
    const before = await readWorker(workerId);
    if (!before || !QR_REQUESTABLE_STATUS_IDS.has(before.worker_status_id)) {
      await waitForReady(workerId, type);
    }

    const startedAt = Date.now();
    const ack = await api(
      'POST',
      `/worker/${encodeURIComponent(workerId)}/connection/qrcode`,
      {
        body: {},
        traceId,
        context,
        timeoutMs: apiTimeoutMs,
      }
    );

    const qr =
      ack.qrcode && ack.worker_type_id === type.id
        ? {
            source: 'http',
            qrcode: ack.qrcode,
            connection_attempt_id: ack.connection_attempt_id,
            qr_generated_at: ack.qr_generated_at,
            runtime_generation: ack.runtime_generation,
          }
        : await waitForQrCache(workerId, type, ack.connection_attempt_id);

    return {
      worker_id: workerId,
      type: type.key,
      account_id: context?.account_id,
      account_name: context?.account_name,
      ack_status: ack.status,
      ack_code: ack.code,
      ack_reason: ack.reason,
      qr_pending: ack.qr_pending === true,
      connection_attempt_id: ack.connection_attempt_id,
      debug_trace_id: ack.debug_trace_id ?? traceId,
      qr_source: qr.source,
      qr_length: qr.qrcode.length,
      qr_generated_at: qr.qr_generated_at,
      runtime_generation: qr.runtime_generation,
      total_ms: Date.now() - startedAt,
    };
  });
}

async function runStressScenario(count) {
  report.stress = {
    worker_count: count,
    qr_burst_size: qrBurstSize,
    started_at: new Date().toISOString(),
  };

  const created = await step('stress:create:concurrent', async () => {
    const tasks = Array.from({ length: count }, (_, index) => {
      const type = WORKER_TYPES[index % WORKER_TYPES.length];
      return createChannel(
        type,
        `${baseName}-stress-${index + 1}-${type.key}`,
        `stress:create:${index + 1}:${type.key}`
      );
    });

    const results = await settleOrThrow(tasks, 'stress create');
    return results.map((item) => ({
      worker_id: item.worker_id,
      name: item.name,
      type: item.type,
      ready_ms: item.ready_ms,
      warm_pool_claimed: item.warm_pool_claimed,
      fallback_created: item.fallback_created,
    }));
  });

  report.stress.created = created;

  const workers = created.map((item) => ({
    ...item,
    type: workerTypeByKey(item.type),
  }));

  const bursts = await step('stress:qr-burst:concurrent', async () => {
    return settleOrThrow(
      workers.map((worker, index) =>
        qrBurst(
          worker.worker_id,
          worker.type,
          `stress:${index + 1}:${worker.type.key}`,
          qrBurstSize
        )
      ),
      'stress QR burst'
    );
  });
  report.stress.qr_bursts = bursts;

  const recreates = await step('stress:reset-recreate:concurrent', async () => {
    return settleOrThrow(
      workers.map((worker, index) =>
        recreateAndQr(worker.worker_id, worker.name, worker.type.key, {
          index: `stress-${index + 1}`,
          route: 'reset',
        })
      ),
      'stress reset recreate'
    );
  });
  report.stress.recreates = recreates;

  const switches = await step('stress:switch:concurrent', async () => {
    return settleOrThrow(
      workers.map((worker, index) => {
        const nextType = WORKER_TYPES[(index + 1) % WORKER_TYPES.length];
        return switchTypeAndQr(
          worker.worker_id,
          worker.name,
          nextType,
          `stress-${index + 1}-${nextType.key}`
        );
      }),
      'stress switch'
    );
  });
  report.stress.switches = switches;
  report.stress.finished_at = new Date().toISOString();
}

async function runMultiAccountStressScenario() {
  const contexts = await resolveStressAccountContexts();
  const contextsByAccountId = new Map(
    contexts.map((context) => [context.account_id, context])
  );

  report.multi_account_stress = {
    account_count: contexts.length,
    accounts: contexts.map(publicAuthContext),
    worker_types: WORKER_TYPES.map((type) => type.key),
    workers_per_type_per_account: multiAccountWorkersPerType,
    qr_burst_size: multiAccountQrBurstSize,
    started_at: new Date().toISOString(),
  };

  const created = await step('multi-account:create:concurrent', async () => {
    const tasks = [];

    for (const context of contexts) {
      for (const type of WORKER_TYPES) {
        for (let index = 1; index <= multiAccountWorkersPerType; index += 1) {
          tasks.push(
            createChannel(
              type,
              `${baseName}-${context.account_key}-${type.key}-${index}`,
              `multi-account:create:${context.account_key}:${type.key}:${index}`,
              context
            )
          );
        }
      }
    }

    const results = await settleOrThrow(tasks, 'multi-account create');
    return results.map((item) => ({
      worker_id: item.worker_id,
      name: item.name,
      type: item.type,
      account_id: item.account_id,
      account_name: item.account_name,
      ready_ms: item.ready_ms,
      warm_pool_claimed: item.warm_pool_claimed,
      fallback_created: item.fallback_created,
    }));
  });

  report.multi_account_stress.created = created;

  const workers = created.map((item) => ({
    ...item,
    type: workerTypeByKey(item.type),
    context: contextsByAccountId.get(item.account_id) ?? defaultAuthContext,
  }));

  const qrByType = {};
  for (const type of WORKER_TYPES) {
    const workersForType = workers.filter(
      (worker) => worker.type.key === type.key
    );
    qrByType[type.key] = await step(
      `multi-account:qr-open:${type.key}:concurrent`,
      async () =>
        settleOrThrow(
          workersForType.map((worker, index) =>
            qrBurst(
              worker.worker_id,
              worker.type,
              `multi-account:${type.key}:${index + 1}:${worker.account_name}`,
              multiAccountQrBurstSize,
              worker.context
            )
          ),
          `multi-account ${type.key} QR burst`
        )
    );
  }
  report.multi_account_stress.qr_by_type = qrByType;

  const recreates = await step(
    'multi-account:reset-recreate:concurrent',
    async () =>
      settleOrThrow(
        workers.map((worker, index) =>
          recreateAndQr(
            worker.worker_id,
            worker.name,
            worker.type.key,
            {
              index: `multi-account-${index + 1}`,
              route: 'reset',
            },
            worker.context
          )
        ),
        'multi-account reset recreate'
      )
  );
  report.multi_account_stress.recreates = recreates;

  const qrAfterRecreateByType = {};
  for (const type of WORKER_TYPES) {
    const workersForType = workers.filter(
      (worker) => worker.type.key === type.key
    );
    qrAfterRecreateByType[type.key] = await step(
      `multi-account:qr-after-recreate:${type.key}:concurrent`,
      async () =>
        settleOrThrow(
          workersForType.map((worker, index) =>
            qrBurst(
              worker.worker_id,
              worker.type,
              `multi-account-after-recreate:${type.key}:${index + 1}:${worker.account_name}`,
              multiAccountQrBurstSize,
              worker.context
            )
          ),
          `multi-account ${type.key} QR after recreate`
        )
    );
  }
  report.multi_account_stress.qr_after_recreate_by_type = qrAfterRecreateByType;
  report.multi_account_stress.finished_at = new Date().toISOString();
}

async function qrBurst(
  workerId,
  type,
  label,
  count,
  context = defaultAuthContext
) {
  const traceId = trace('qr-burst', label.replaceAll(':', '-'));
  const startedAt = Date.now();
  const responses = await Promise.all(
    Array.from({ length: count }, () =>
      api('POST', `/worker/${encodeURIComponent(workerId)}/connection/qrcode`, {
        body: {},
        traceId,
        context,
        timeoutMs: apiTimeoutMs,
      })
    )
  );

  const attempts = responses
    .map((item) => item.connection_attempt_id)
    .filter(Boolean);
  const uniqueAttempts = [...new Set(attempts)];
  if (uniqueAttempts.length > 1) {
    throw new Error(
      `QR burst for ${workerId}/${type.key} produced multiple attempts: ${uniqueAttempts.join(
        ', '
      )}`
    );
  }

  const directQr = responses.find(
    (item) => item.qrcode && item.worker_type_id === type.id
  );
  const qr = directQr
    ? {
        source: 'http',
        qrcode: directQr.qrcode,
        connection_attempt_id: directQr.connection_attempt_id,
        qr_generated_at: directQr.qr_generated_at,
        runtime_generation: directQr.runtime_generation,
      }
    : await waitForQrCache(workerId, type, uniqueAttempts[0]);

  return {
    worker_id: workerId,
    type: type.key,
    account_id: context?.account_id,
    account_name: context?.account_name,
    request_count: count,
    unique_attempt_count: uniqueAttempts.length,
    connection_attempt_id: uniqueAttempts[0],
    statuses: [
      ...new Set(responses.map((item) => item.status).filter(Boolean)),
    ],
    reasons: [...new Set(responses.map((item) => item.reason).filter(Boolean))],
    qr_source: qr.source,
    qr_length: qr.qrcode.length,
    runtime_generation: qr.runtime_generation,
    total_ms: Date.now() - startedAt,
  };
}

async function waitForReady(workerId, type) {
  const deadline = Date.now() + readyTimeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await readWorker(workerId);
    if (
      last?.worker_type_id === type.id &&
      READY_STATUS_IDS.has(last.worker_status_id)
    ) {
      return compactWorker(last);
    }

    if (last?.worker_status_id === WORKER_STATUS.error) {
      throw new Error(
        `Worker ${workerId} reached error while waiting for ${type.key}: ${JSON.stringify(
          compactWorker(last)
        )}`
      );
    }

    await delay(1_000);
  }

  throw new Error(
    `Worker ${workerId} did not become ready as ${type.key}. Last=${JSON.stringify(
      compactWorker(last)
    )}`
  );
}

async function waitForOnlineAfterRecreate(
  workerId,
  type,
  beforeWorker,
  operationId
) {
  const deadline = Date.now() + targetOnlineTimeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await readWorker(workerId);
    const generationAdvanced =
      Number(last?.runtime_generation ?? 0) >
      Number(beforeWorker.runtime_generation ?? 0);
    const containerChanged =
      Boolean(beforeWorker.container_id) &&
      Boolean(last?.container_id) &&
      last.container_id !== beforeWorker.container_id;
    const activatedChanged =
      Boolean(beforeWorker.activated_at) &&
      Boolean(last?.activated_at) &&
      String(last.activated_at) !== String(beforeWorker.activated_at);
    const operationCompleted =
      !operationId || last?.lifecycle_operation_id !== operationId;
    const newRuntimeObserved =
      generationAdvanced || containerChanged || activatedChanged;

    if (
      last?.worker_type_id === type.id &&
      last.worker_status_id === WORKER_STATUS.online &&
      operationCompleted &&
      newRuntimeObserved
    ) {
      return compactWorker(last);
    }

    if (last?.worker_status_id === WORKER_STATUS.error) {
      throw new Error(
        `Target worker ${workerId} reached error while waiting online: ${JSON.stringify(
          compactWorker(last)
        )}`
      );
    }

    await delay(1_000);
  }

  throw new Error(
    `Target worker ${workerId} did not become online after recreate. Last=${JSON.stringify(
      compactWorker(last)
    )}`
  );
}

async function waitForRecreateCooldown(workerId) {
  const deadline = Date.now() + targetCooldownWaitMs;

  while (Date.now() < deadline) {
    const worker = await readWorker(workerId);
    const availableAt = worker?.recreate_available_at
      ? Date.parse(worker.recreate_available_at)
      : 0;

    if (!availableAt || availableAt <= Date.now()) {
      return;
    }

    await delay(Math.min(1_000, Math.max(100, availableAt - Date.now())));
  }

  const worker = await readWorker(workerId);
  throw new Error(
    `Target worker ${workerId} recreate cooldown did not expire in ${targetCooldownWaitMs}ms. recreate_available_at=${worker?.recreate_available_at}`
  );
}

function workerTypeById(id) {
  return WORKER_TYPES.find((item) => item.id === id);
}

function workerTypeByKey(key) {
  const type = WORKER_TYPES.find((item) => item.key === key);
  if (!type) {
    throw new Error(`Unknown worker type key ${key}`);
  }

  return type;
}

async function waitForQrCache(workerId, type, connectionAttemptId) {
  const deadline = Date.now() + qrTimeoutMs;
  const key = qrAttemptCacheKey(workerId, type.id);
  let last = null;

  while (Date.now() < deadline) {
    const raw = await redis.get(key);
    if (raw) {
      try {
        last = JSON.parse(raw);
      } catch {
        last = { invalid_json: true, raw_length: raw.length };
      }

      const sameAttempt =
        !connectionAttemptId ||
        !last.connection_attempt_id ||
        last.connection_attempt_id === connectionAttemptId;

      if (
        last?.qrcode &&
        last.worker_id === workerId &&
        last.worker_type_id === type.id &&
        sameAttempt
      ) {
        return {
          source: 'redis',
          qrcode: last.qrcode,
          connection_attempt_id: last.connection_attempt_id,
          qr_generated_at: last.qr_generated_at,
          runtime_generation: last.runtime_generation,
        };
      }
    }

    await delay(750);
  }

  throw new Error(
    `QR was not cached for ${workerId}/${type.key}. attempt=${connectionAttemptId} last=${JSON.stringify(
      redactQr(last)
    )}`
  );
}

async function login() {
  const data = await api('POST', '/auth/login', {
    body: {
      login: requiredEnv('E2E_LOGIN'),
      password: requiredEnv('E2E_PASSWORD'),
    },
    timeoutMs: apiTimeoutMs,
    anonymous: true,
  });

  if (!data?.token) {
    throw new Error('Login did not return a token.');
  }

  return data;
}

async function resolveStressAccountContexts() {
  const requestedAccountIds =
    listArg('--stress-account-ids') ??
    KNOWN_STRESS_ACCOUNTS.map((account) => account.account_id);
  const requestedIds = new Set(requestedAccountIds);
  const accounts = await listAccessibleAccounts();
  const accountById = new Map(
    accounts.map((account) => [account.account_id, account])
  );

  if (defaultAuthContext?.account_id) {
    requestedIds.add(defaultAuthContext.account_id);
    if (!accountById.has(defaultAuthContext.account_id)) {
      accountById.set(defaultAuthContext.account_id, {
        account_id: defaultAuthContext.account_id,
        name: defaultAuthContext.account_name,
      });
    }
  }

  const contexts = [];
  for (const accountId of requestedIds) {
    const known =
      accountById.get(accountId) ??
      KNOWN_STRESS_ACCOUNTS.find((account) => account.account_id === accountId);
    if (!known) {
      throw new Error(`Stress account ${accountId} was not found`);
    }

    const context = await resolveAccountContext(known);
    contexts.push(context);
    recordAuthContext(context);
  }

  if (contexts.length < 2) {
    throw new Error(
      `Multi-account stress requires at least 2 account contexts, got ${contexts.length}`
    );
  }

  return contexts;
}

async function listAccessibleAccounts() {
  let userAccountsError = null;
  try {
    const accounts = await api('GET', '/user/accounts', {
      context: defaultAuthContext,
      timeoutMs: apiTimeoutMs,
    });
    if (Array.isArray(accounts)) {
      return accounts.map(normalizeAccount).filter(Boolean);
    }
  } catch (error) {
    userAccountsError = errorMessage(error);
  }

  const accountList = await api('GET', '/account?current_page=1&per_page=100', {
    context: defaultAuthContext,
    timeoutMs: apiTimeoutMs,
  });
  if (userAccountsError) {
    report.account_discovery = { user_accounts_error: userAccountsError };
  }
  const results = Array.isArray(accountList?.results)
    ? accountList.results
    : [];
  return results.map(normalizeAccount).filter(Boolean);
}

async function resolveAccountContext(account) {
  if (account.account_id === defaultAuthContext?.account_id) {
    return {
      ...defaultAuthContext,
      account_name: account.name ?? defaultAuthContext.account_name,
      account_key: accountKey(account.name ?? defaultAuthContext.account_name),
    };
  }

  const user = await findSessionLoginUserForAccount(account);
  const sessionData = await api(
    'POST',
    `/user/${encodeURIComponent(user.user_id)}/session-login`,
    {
      context: defaultAuthContext,
      timeoutMs: apiTimeoutMs,
    }
  );

  const context = buildAuthContextFromLogin(
    sessionData,
    'session-login',
    account
  );

  if (context.account_id !== account.account_id) {
    throw new Error(
      `Session login for ${account.name} returned account ${context.account_id}`
    );
  }

  return context;
}

async function findSessionLoginUserForAccount(account) {
  const query = new URLSearchParams({
    account_id: account.account_id,
    current_page: '1',
    per_page: '20',
  });
  const data = await api('GET', `/user?${query.toString()}`, {
    context: defaultAuthContext,
    timeoutMs: apiTimeoutMs,
  });
  const users = Array.isArray(data?.results) ? data.results : [];
  const user =
    users.find(
      (item) =>
        item.account?.account_id === account.account_id &&
        item.user_status?.name === 'active'
    ) ?? users.find((item) => item.account?.account_id === account.account_id);

  if (!user?.user_id) {
    throw new Error(`No session-login user found for account ${account.name}`);
  }

  return user;
}

function buildAuthContextFromLogin(data, source, accountFallback = null) {
  const accountName =
    data?.layout?.name ??
    accountFallback?.name ??
    data?.user?.account?.name ??
    data?.user?.account_name ??
    data?.user?.account_id ??
    'account';

  return {
    token: data.token,
    source,
    user_id: data?.user?.user_id,
    account_id: data?.user?.account_id ?? accountFallback?.account_id,
    account_name: accountName,
    account_key: accountKey(accountName),
  };
}

function publicAuthContext(context) {
  if (!context) {
    return null;
  }

  return {
    source: context.source,
    user_id: context.user_id,
    account_id: context.account_id,
    account_name: context.account_name,
    account_key: context.account_key,
  };
}

function recordAuthContext(context) {
  if (!context?.account_id) {
    return;
  }

  const alreadyRecorded = report.account_contexts.some(
    (item) => item?.account_id === context.account_id
  );
  if (!alreadyRecorded) {
    report.account_contexts.push(publicAuthContext(context));
  }
}

function normalizeAccount(account) {
  if (!account?.account_id) {
    return null;
  }

  return {
    account_id: account.account_id,
    name: account.name ?? account.account?.name ?? account.account_id,
  };
}

function accountKey(name) {
  const normalized = String(name ?? 'account')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'account';
}

async function api(method, route, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? apiTimeoutMs
  );

  try {
    const headers = {
      'Accept-Language': 'pt',
      'X-Client-Platform': 'web',
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const requestToken = options.context?.token ?? options.token ?? token;
    if (!options.anonymous && requestToken) {
      headers.Authorization = `Bearer ${requestToken}`;
    }

    if (options.traceId) {
      headers['x-connection-lifecycle-debug-trace-id'] = options.traceId;
    }

    const response = await fetch(`${apiUrl}${route}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);
    const allowedStatuses = options.allowHttpStatuses ?? [200, 201, 202];
    const allowed = new Set(allowedStatuses);
    const statusExplicitlyAllowed = allowedStatuses.includes(response.status);

    if (
      !allowed.has(response.status) ||
      (!statusExplicitlyAllowed && !body?.status)
    ) {
      const error = new Error(
        `${method} ${route} failed HTTP ${response.status}: ${JSON.stringify(
          body
        )}`
      );
      error.response = body;
      error.httpStatus = response.status;
      throw error;
    }

    if (statusExplicitlyAllowed) {
      return {
        ...body.data,
        __http_status: response.status,
        message: body.message,
        data: body.data,
      };
    }

    return body.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function readWorker(workerId) {
  const result = await pool.query(
    `
      select
        w.worker_id,
        w.name,
        w.worker_status_id,
        ws.status as worker_status,
        w.worker_type_id,
        wt.type as worker_type,
        w.server_id,
        w.account_id,
        w.number,
        w.container_id,
        w.connection_date,
        w.updated_at,
        w.deleted_at,
        w.lifecycle_operation_id,
        w.recreate_available_at,
        wr.container_name,
        wr.session_volume_name,
        wr.runtime_generation,
        wr.warm_pool_id,
        wr.activated_at
      from worker w
      left join worker_status ws on ws.worker_status_id = w.worker_status_id
      left join worker_type wt on wt.worker_type_id = w.worker_type_id
      left join worker_runtime wr on wr.worker_id = w.worker_id
      where w.worker_id = $1
      limit 1
    `,
    [workerId]
  );

  return result.rows[0] ?? null;
}

function compactWorker(worker) {
  if (!worker) {
    return null;
  }

  return {
    worker_id: worker.worker_id,
    name: worker.name,
    status: worker.worker_status,
    status_id: worker.worker_status_id,
    type: worker.worker_type,
    type_id: worker.worker_type_id,
    server_id: worker.server_id,
    account_id: worker.account_id,
    number: worker.number,
    container_id: worker.container_id,
    connection_date: worker.connection_date,
    container_name: worker.container_name,
    session_volume_name: worker.session_volume_name,
    runtime_generation: worker.runtime_generation,
    warm_pool_id: worker.warm_pool_id,
    lifecycle_operation_id: worker.lifecycle_operation_id,
    recreate_available_at: worker.recreate_available_at,
    updated_at: worker.updated_at,
    activated_at: worker.activated_at,
    deleted_at: worker.deleted_at,
  };
}

async function step(name, action) {
  const startedAt = Date.now();
  console.log(`START ${name}`);
  try {
    const result = await action();
    const entry = {
      name,
      ok: true,
      duration_ms: Date.now() - startedAt,
      result: redactQr(result),
    };
    report.steps.push(entry);
    console.log(`OK ${name} ${entry.duration_ms}ms`);
    return result;
  } catch (error) {
    const entry = {
      name,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: errorMessage(error),
    };
    report.steps.push(entry);
    report.failures.push(entry);
    console.error(`ERR ${name} ${entry.duration_ms}ms ${entry.error}`);
    throw error;
  }
}

async function collectRemoteLogsForCreatedWorkers() {
  if (
    !process.env.CHANNEL_WORKER_SSH_HOST ||
    !process.env.CHANNEL_WORKER_SSH_PASSWORD
  ) {
    return;
  }

  for (const created of report.created_workers) {
    const worker = await readWorker(created.worker_id);
    const target = worker?.container_name || worker?.container_id;
    if (!target) {
      report.remote_logs[created.worker_id] = {
        skipped: 'missing container target',
      };
      continue;
    }

    try {
      report.remote_logs[created.worker_id] = {
        target,
        tail: remoteDockerLogs(target, '45m'),
      };
    } catch (error) {
      report.remote_logs[created.worker_id] = {
        target,
        error: errorMessage(error),
      };
    }
  }
}

async function collectFailureContext() {
  if (!process.env.CHANNEL_WORKER_SSH_HOST) {
    return;
  }

  try {
    report.remote_logs.balance = {
      target: 'under-balance-api',
      tail: remoteDockerLogs('under-balance-api', '45m'),
    };
  } catch (error) {
    report.remote_logs.balance = {
      target: 'under-balance-api',
      error: errorMessage(error),
    };
  }

  try {
    await collectRemoteLogsForCreatedWorkers();
  } catch (error) {
    report.remote_logs.created_workers_error = errorMessage(error);
  }
}

async function collectTargetRemoteLogs(workerId, since) {
  if (!process.env.CHANNEL_WORKER_SSH_HOST) {
    return;
  }

  report.target_channel.remote_logs = {};
  try {
    report.target_channel.remote_logs.balance = {
      target: 'under-balance-api',
      tail: remoteDockerLogs('under-balance-api', since),
    };
  } catch (error) {
    report.target_channel.remote_logs.balance = {
      error: errorMessage(error),
    };
  }

  try {
    report.target_channel.remote_logs.worker = {
      target: workerId,
      tail: remoteDockerLogs(workerId, since),
    };
  } catch (error) {
    report.target_channel.remote_logs.worker = {
      target: workerId,
      error: errorMessage(error),
    };
  }
}

async function settleOrThrow(promises, label) {
  const results = await Promise.allSettled(promises);
  const rejected = results
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === 'rejected');

  if (rejected.length > 0) {
    throw new Error(
      `${label} failed: ${rejected
        .map(({ item, index }) => `${index + 1}:${errorMessage(item.reason)}`)
        .join('; ')}`
    );
  }

  return results.map((item) => item.value);
}

function remoteDockerLogs(container, since) {
  const host = requiredEnv('CHANNEL_WORKER_SSH_HOST');
  const user = process.env.CHANNEL_WORKER_SSH_USER ?? 'root';
  const port = process.env.CHANNEL_WORKER_SSH_PORT ?? '22';
  const password = requiredEnv('CHANNEL_WORKER_SSH_PASSWORD');
  const command = `docker logs --since=${shellQuote(since)} ${shellQuote(
    container
  )} 2>&1 | tail -240`;

  return execFileSync(
    'sshpass',
    [
      '-p',
      password,
      'ssh',
      '-p',
      port,
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'ConnectTimeout=10',
      `${user}@${host}`,
      command,
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 }
  );
}

async function cleanupAndExit(code) {
  if (!keepChannels && token) {
    for (const created of [...report.created_workers].reverse()) {
      try {
        const context =
          workerAuthContexts.get(created.worker_id) ?? defaultAuthContext;
        await api(
          'DELETE',
          `/worker/${encodeURIComponent(created.worker_id)}`,
          {
            context,
            timeoutMs: apiTimeoutMs,
          }
        );
        report.deleted_workers.push(created.worker_id);
      } catch (error) {
        report.failures.push({
          step: `delete:${created.worker_id}`,
          error: errorMessage(error),
        });
      }
    }
  }

  report.finished_at = new Date().toISOString();
  report.duration_ms =
    Date.parse(report.finished_at) - Date.parse(report.started_at);

  await writeReport();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(code);
}

async function writeReport() {
  await mkdir(path.join(ROOT, 'test-results'), { recursive: true });
  const file = path.join(ROOT, 'test-results', `channel-chaos-${stamp}.json`);
  await writeFile(file, `${JSON.stringify(redactQr(report), null, 2)}\n`);
  console.log(`REPORT ${file}`);
}

function qrAttemptCacheKey(workerId, workerTypeId) {
  return `connection:qrcode:${workerTypeId}:${workerId}:attempt`;
}

function trace(prefix, label) {
  return `codex_${prefix}_${label}_${randomUUID()}`;
}

function redactQr(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(redactQr);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (['qrcode', 'qr', 'qr_code', 'qrCode'].includes(key)) {
      const raw = typeof item === 'string' ? item : '';
      output.has_qr = raw.length > 0;
      output.qr_length = raw.length;
      continue;
    }

    if (['pairing_code', 'pairingCode'].includes(key)) {
      const raw = typeof item === 'string' ? item : '';
      output.has_pairing_code = raw.length > 0;
      output.pairing_code_length = raw.length;
      continue;
    }

    output[key] = redactQr(item);
  }

  return output;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function requiredDbEnv(name) {
  return (
    process.env[`E2E_DB_${name}`]?.trim() ||
    process.env[`DB_${name}_RO`]?.trim() ||
    process.env[`DB_${name}`]?.trim() ||
    requiredEnv(`E2E_DB_${name}`)
  );
}

function numberArg(name, fallback) {
  const raw = valueArg(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function listArg(name) {
  const raw = valueArg(name);
  if (!raw) {
    return undefined;
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function valueArg(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
