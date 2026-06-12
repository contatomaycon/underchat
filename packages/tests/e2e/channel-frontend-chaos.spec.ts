import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const WORKER_STATUS = {
  disponible: '019a930d-c6f6-766d-9c84-3904383fe742',
  offline: '019a930d-c6f6-766d-9c84-3696c2cd5ed8',
  online: '019a930d-c6f6-766d-9c84-30af6ecc33b2',
  creating: '019a930d-c6f6-766d-9c84-52e87789979b',
  recreating: '019a930d-c6f6-766d-9c84-46093814d8e0',
  error: '019a930d-c6f6-766d-9c84-48cb970a9f21',
  mismatched: '019a930d-c6f6-766d-9c84-5056ccf66633',
};

const READY_STATUS_IDS = new Set<string>([
  WORKER_STATUS.disponible,
  WORKER_STATUS.offline,
  WORKER_STATUS.mismatched,
]);

const WORKER_TYPES = {
  baileys: {
    key: 'baileys',
    id: '019a930d-c6f6-766d-9c84-53307d4159a1',
  },
  wwebjs: {
    key: 'wwebjs',
    id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
  },
  whatsmeow: {
    key: 'whatsmeow',
    id: 'e80ad183-2b46-4628-9105-a036f2d28720',
  },
} as const;

type WorkerTypeKey = keyof typeof WORKER_TYPES;
type WorkerTypeConfig = (typeof WORKER_TYPES)[WorkerTypeKey];

interface ApiEnvelope<T> {
  status: boolean;
  message?: string;
  data: T;
}

interface JsonResponseLike {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
}

interface LoginResponse {
  token: string;
  user: Record<string, unknown>;
  permissions?: string[];
  layout?: unknown;
  sectors?: string[];
  channels?: unknown[];
  plan_is_active?: boolean;
}

interface CreateWorkerResponse {
  worker_id: string;
  account_id?: string;
  worker_type_id?: string;
  worker_status_id?: string;
  debug_trace_id?: string;
}

interface ConnectionState {
  status?: string;
  code?: number;
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  connection_attempt_id?: string;
  runtime_generation?: number;
  qrcode?: string;
  pairing_code?: string;
  qr_pending?: boolean;
  reason?: string;
}

interface WorkerDbRow {
  worker_id: string;
  name: string;
  worker_status_id: string;
  worker_status: string | null;
  worker_type_id: string;
  worker_type: string | null;
  account_id: string;
  number: string | null;
  container_id: string | null;
  runtime_generation: number | null;
  deleted_at: string | null;
}

interface RuntimeConfig {
  apiUrl: string;
  login: string;
  password: string;
  baseName: string;
  qrMaxMs: number;
  readyMaxMs: number;
  stressWorkersPerType: number;
  stressTypes: WorkerTypeConfig[];
}

interface RuntimeContext {
  config: RuntimeConfig;
  pool: pg.Pool;
  loginData: LoginResponse;
  startedAt: string;
}

interface CreatedWorker {
  workerId: string;
  name: string;
  type: WorkerTypeConfig;
  source: 'ui' | 'api';
}

interface PageProbe {
  consoleLifecycle: Record<string, unknown>[];
  consoleErrors: string[];
  pageErrors: string[];
  network: Record<string, unknown>[];
  requestFailures: Record<string, unknown>[];
}

const e2eEnabled = process.env.E2E_FRONTEND_CONNECTION_CHAOS_ENABLED === 'true';
const createdWorkers: CreatedWorker[] = [];
let runtime: RuntimeContext | undefined;

test.describe.serial('channel frontend connection chaos', () => {
  test.describe.configure({
    timeout: readPositiveIntegerEnv('E2E_FRONTEND_TEST_TIMEOUT_MS', 420_000),
  });

  test.skip(
    !e2eEnabled,
    'Set E2E_FRONTEND_CONNECTION_CHAOS_ENABLED=true to create real channels through the UI and stress QR rendering.'
  );

  test.beforeAll(async ({ request }) => {
    const config = readRuntimeConfig();
    const pool = createPool();
    const loginData = await login(request, config);

    runtime = {
      config,
      pool,
      loginData,
      startedAt: new Date().toISOString(),
    };
  });

  test.afterAll(async ({ request }) => {
    if (!runtime) {
      return;
    }

    try {
      await cleanupCreatedWorkers(request, runtime);
    } finally {
      await runtime.pool.end();
      runtime = undefined;
    }
  });

  test('creates a WWebJS channel in the UI and renders QR before any disconnected state', async ({
    page,
    request,
  }, testInfo) => {
    const ctx = requireRuntime();
    const probe = observePage(page);
    const name = `${ctx.config.baseName}-ui-wwebjs`;

    const created = await createWwebjsChannelThroughUi(page, ctx, name);
    createdWorkers.push(created);

    const result = await waitForConnectionQrThroughUi(
      page,
      ctx,
      created,
      testInfo
    );

    await attachFrontendArtifacts(testInfo, ctx, [created], probe, {
      uiCreateResult: result,
      workerLogs: await fetchWorkersConnectionLogs(request, ctx, [created]),
      remoteLogs: await collectRemoteLogs(ctx, [created]),
    });

    expect(probe.pageErrors).toEqual([]);
    expect(
      probe.consoleErrors.filter((entry) =>
        /connection|qrcode|worker|centrifugo/i.test(entry)
      )
    ).toEqual([]);
  });

  test('opens concurrent QR dialogs from the frontend under load', async ({
    context,
    request,
  }, testInfo) => {
    const ctx = requireRuntime();
    const workers = await createStressWorkers(request, ctx);
    createdWorkers.push(...workers);

    await Promise.all(
      workers.map((worker) => waitForWorkerReady(ctx, worker.workerId))
    );

    const probes: Array<{ workerId: string; probe: PageProbe }> = [];
    const results = await Promise.all(
      workers.map(async (worker) => {
        const page = await context.newPage();
        const probe = observePage(page);
        probes.push({ workerId: worker.workerId, probe });

        try {
          await installAuthenticatedStorage(page, ctx.loginData);
          return await connectExistingWorkerThroughUi(page, ctx, worker);
        } finally {
          await page.close();
        }
      })
    );

    await attachFrontendArtifacts(testInfo, ctx, workers, mergeProbes(probes), {
      stressResults: results,
      workerLogs: await fetchWorkersConnectionLogs(request, ctx, workers),
      remoteLogs: await collectRemoteLogs(ctx, workers),
    });

    const pageErrors = probes.flatMap((item) => item.probe.pageErrors);
    expect(pageErrors).toEqual([]);
    expect(results.every((result) => result.outcome === 'qr')).toBe(true);
  });
});

async function createWwebjsChannelThroughUi(
  page: Page,
  ctx: RuntimeContext,
  name: string
): Promise<CreatedWorker> {
  await installAuthenticatedStorage(page, ctx.loginData);
  await page.goto('/channels');
  await expect(
    page.getByTestId('channels-search').locator('input')
  ).toBeVisible({ timeout: 30_000 });

  await page
    .getByRole('button', { name: /Adicionar|Add/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog').filter({
    hasText: /Adicionar canal|Add channel/i,
  });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByTestId('add-channel-type-select').click();
  await page
    .getByTestId(`add-channel-type-option-${WORKER_TYPES.wwebjs.id}`)
    .click();
  await dialog.getByPlaceholder(/Nome|Name/i).fill(name);

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/worker') &&
      !response.url().includes('/connection'),
    { timeout: 30_000 }
  );

  await dialog.getByRole('button', { name: /Adicionar|Add/i }).click();
  const createResponse = await createResponsePromise;
  const data = await assertApiResponse<CreateWorkerResponse>(
    createResponse,
    'UI worker create'
  );

  await expect(page.getByTestId('connection-dialog')).toBeVisible({
    timeout: 30_000,
  });

  return {
    workerId: data.worker_id,
    name,
    type: WORKER_TYPES.wwebjs,
    source: 'ui',
  };
}

async function connectExistingWorkerThroughUi(
  page: Page,
  ctx: RuntimeContext,
  worker: CreatedWorker
): Promise<Record<string, unknown>> {
  await openChannelsPageForWorker(page, ctx, worker);
  return waitForConnectionQrThroughUi(page, ctx, worker);
}

async function openChannelsPageForWorker(
  page: Page,
  ctx: RuntimeContext,
  worker: CreatedWorker
): Promise<void> {
  await installAuthenticatedStorage(page, ctx.loginData);
  await page.goto('/channels');

  const searchInput = page.getByTestId('channels-search').locator('input');
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await searchInput.fill(worker.name);
  await expect(
    page.getByTestId(`channel-connect-${worker.workerId}`)
  ).toBeVisible({ timeout: ctx.config.readyMaxMs });
}

async function waitForConnectionQrThroughUi(
  page: Page,
  ctx: RuntimeContext,
  worker: CreatedWorker,
  testInfo?: TestInfo
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const qrResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(`/worker/${worker.workerId}/connection/qrcode`),
      { timeout: ctx.config.qrMaxMs }
    )
    .catch(() => null);

  if (
    !(await page
      .getByTestId('connection-dialog')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId(`channel-connect-${worker.workerId}`).click();
    await expect(page.getByTestId('connection-dialog')).toBeVisible({
      timeout: 10_000,
    });
  }

  const disconnected = page
    .getByText(/Canal desconectado|Channel disconnected/i)
    .waitFor({ state: 'visible', timeout: ctx.config.qrMaxMs })
    .then(() => 'disconnected' as const)
    .catch(() => null);
  const qr = expectQrImage(
    page.getByTestId('connection-qr-image'),
    ctx.config.qrMaxMs
  )
    .then(() => 'qr' as const)
    .catch((error) => {
      throw error;
    });

  const outcome = await Promise.race([qr, disconnected]);
  if (outcome !== 'qr') {
    await testInfo?.attach(`frontend-disconnected-${worker.workerId}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    throw new Error(
      `Connection dialog reached disconnected before QR for ${worker.workerId}.`
    );
  }

  const qrResponse = await qrResponsePromise;
  const qrState = qrResponse
    ? await assertApiResponse<ConnectionState>(qrResponse, 'UI QR request')
    : null;

  return {
    workerId: worker.workerId,
    name: worker.name,
    type: worker.type.key,
    source: worker.source,
    outcome,
    qrMs: Date.now() - startedAt,
    qrResponse: sanitizePayload(qrState),
  };
}

async function createStressWorkers(
  request: APIRequestContext,
  ctx: RuntimeContext
): Promise<CreatedWorker[]> {
  const workers: CreatedWorker[] = [];

  for (const type of ctx.config.stressTypes) {
    for (let index = 0; index < ctx.config.stressWorkersPerType; index += 1) {
      const name = `${ctx.config.baseName}-stress-${type.key}-${index}`;
      const response = await request.post(`${ctx.config.apiUrl}/worker`, {
        data: {
          name,
          worker_type: type.id,
        },
        headers: authHeaders(ctx.loginData.token, { json: true }),
      });
      const data = await assertApiResponse<CreateWorkerResponse>(
        response,
        `create stress worker ${name}`
      );
      workers.push({
        workerId: data.worker_id,
        name,
        type,
        source: 'api',
      });
    }
  }

  return workers;
}

async function waitForWorkerReady(
  ctx: RuntimeContext,
  workerId: string
): Promise<WorkerDbRow> {
  const deadline = Date.now() + ctx.config.readyMaxMs;
  let lastWorker: WorkerDbRow | null = null;

  while (Date.now() < deadline) {
    lastWorker = await readWorkerFromDb(ctx.pool, workerId);
    if (lastWorker && READY_STATUS_IDS.has(lastWorker.worker_status_id)) {
      return lastWorker;
    }
    if (lastWorker?.worker_status_id === WORKER_STATUS.error) {
      throw new Error(`Worker ${workerId} reached error state.`);
    }
    await delay(1_000);
  }

  throw new Error(
    `Worker ${workerId} did not become ready. Last state: ${JSON.stringify(
      lastWorker
    )}`
  );
}

async function readWorkerFromDb(
  pool: pg.Pool,
  workerId: string
): Promise<WorkerDbRow | null> {
  const result = await pool.query<WorkerDbRow>(
    `
      select
        w.worker_id,
        w.name,
        w.worker_status_id,
        ws.status as worker_status,
        w.worker_type_id,
        wt.type as worker_type,
        w.account_id,
        w.number,
        w.container_id,
        wr.runtime_generation,
        w.deleted_at
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

async function cleanupCreatedWorkers(
  request: APIRequestContext,
  ctx: RuntimeContext
): Promise<void> {
  const cleanupLoginData = await login(request, ctx.config).catch(
    () => ctx.loginData
  );
  const cleanupFailures: Array<Record<string, unknown>> = [];

  for (const worker of [...createdWorkers].reverse()) {
    try {
      const response = await request.delete(
        `${ctx.config.apiUrl}/worker/${worker.workerId}`,
        {
          headers: authHeaders(cleanupLoginData.token),
        }
      );
      const body = await response.text().catch(() => '');
      if (!response.ok()) {
        cleanupFailures.push({
          workerId: worker.workerId,
          status: response.status(),
          body,
        });
      }
    } catch (error) {
      cleanupFailures.push({
        workerId: worker.workerId,
        error: String(error),
      });
    }
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const remaining = await listNotDeletedWorkers(
      ctx.pool,
      createdWorkers.map((worker) => worker.workerId)
    );
    if (remaining.length === 0) {
      return;
    }
    await delay(1_000);
  }

  const remaining = await listNotDeletedWorkers(
    ctx.pool,
    createdWorkers.map((worker) => worker.workerId)
  );
  if (cleanupFailures.length > 0 || remaining.length > 0) {
    throw new Error(
      `Failed to cleanup frontend E2E workers: ${JSON.stringify({
        cleanupFailures,
        remaining,
      })}`
    );
  }
}

async function listNotDeletedWorkers(
  pool: pg.Pool,
  workerIds: string[]
): Promise<WorkerDbRow[]> {
  if (workerIds.length === 0) {
    return [];
  }

  const result = await pool.query<WorkerDbRow>(
    `
      select
        w.worker_id,
        w.name,
        w.worker_status_id,
        ws.status as worker_status,
        w.worker_type_id,
        wt.type as worker_type,
        w.account_id,
        w.number,
        w.container_id,
        wr.runtime_generation,
        w.deleted_at
      from worker w
      left join worker_status ws on ws.worker_status_id = w.worker_status_id
      left join worker_type wt on wt.worker_type_id = w.worker_type_id
      left join worker_runtime wr on wr.worker_id = w.worker_id
      where w.worker_id = any($1)
        and w.deleted_at is null
      order by w.name
    `,
    [workerIds]
  );

  return result.rows;
}

async function fetchWorkersConnectionLogs(
  request: APIRequestContext,
  ctx: RuntimeContext,
  workers: CreatedWorker[]
): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const worker of workers) {
    const response = await request
      .get(`${ctx.config.apiUrl}/worker/logs/connection/${worker.workerId}`, {
        headers: authHeaders(ctx.loginData.token),
        params: {
          size: 120,
          sort: 'desc',
        },
      })
      .catch(() => null);

    if (!response) {
      output[worker.workerId] = { error: 'request_failed' };
      continue;
    }

    output[worker.workerId] = sanitizePayload(
      await response.json().catch(() => null)
    );
  }

  return output;
}

async function collectRemoteLogs(
  ctx: RuntimeContext,
  workers: CreatedWorker[]
): Promise<string | null> {
  const host =
    optionalEnv('E2E_CHANNEL_WORKER_SSH_HOST') ??
    optionalEnv('CHANNEL_WORKER_SSH_HOST');
  const password =
    optionalEnv('E2E_CHANNEL_WORKER_SSH_PASSWORD') ??
    optionalEnv('CHANNEL_WORKER_SSH_PASSWORD');
  const user =
    optionalEnv('E2E_CHANNEL_WORKER_SSH_USER') ??
    optionalEnv('CHANNEL_WORKER_SSH_USER') ??
    'root';
  const port =
    optionalEnv('E2E_CHANNEL_WORKER_SSH_PORT') ??
    optionalEnv('CHANNEL_WORKER_SSH_PORT') ??
    '22';

  if (!host || !password) {
    return null;
  }

  const containerNames = [
    'under-balance-api',
    ...workers.map((w) => w.workerId),
  ];
  const command = containerNames
    .map((name) => {
      const escapedName = shellEscape(name);
      return `echo ===== ${escapedName} =====; docker logs --since ${shellEscape(
        ctx.startedAt
      )} --tail 300 ${escapedName} 2>&1 || true`;
    })
    .join('; ');

  try {
    const { stdout, stderr } = await execFileAsync(
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
        `${user}@${host}`,
        command,
      ],
      {
        timeout: 45_000,
        maxBuffer: 1024 * 1024 * 4,
      }
    );
    return `${stdout}\n${stderr}`.trim();
  } catch (error) {
    return `remote log collection failed: ${String(error)}`;
  }
}

function observePage(page: Page): PageProbe {
  const probe: PageProbe = {
    consoleLifecycle: [],
    consoleErrors: [],
    pageErrors: [],
    network: [],
    requestFailures: [],
  };

  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') {
      probe.consoleErrors.push(text);
    }

    const marker = '[connection-lifecycle-debug]';
    if (!text.includes(marker)) {
      return;
    }

    const jsonStart = text.indexOf('{');
    if (jsonStart < 0) {
      return;
    }

    try {
      probe.consoleLifecycle.push(JSON.parse(text.slice(jsonStart)));
    } catch {
      probe.consoleLifecycle.push({ raw: text });
    }
  });

  page.on('pageerror', (error) => {
    probe.pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    probe.requestFailures.push({
      method: request.method(),
      url: request.url(),
      error: failure?.errorText,
    });
  });

  page.on('response', async (response) => {
    const url = response.url();
    const request = response.request();
    if (!url.includes('/worker')) {
      return;
    }

    const entry: Record<string, unknown> = {
      method: request.method(),
      url,
      status: response.status(),
    };

    if (
      /\/worker(\/|$)/.test(url) &&
      response.headers()['content-type']?.includes('json')
    ) {
      entry.body = sanitizePayload(await response.json().catch(() => null));
    }

    probe.network.push(entry);
  });

  return probe;
}

function mergeProbes(
  probes: Array<{ workerId: string; probe: PageProbe }>
): PageProbe {
  return {
    consoleLifecycle: probes.flatMap((item) =>
      item.probe.consoleLifecycle.map((event) => ({
        worker_page_id: item.workerId,
        ...event,
      }))
    ),
    consoleErrors: probes.flatMap((item) =>
      item.probe.consoleErrors.map((error) => `${item.workerId}: ${error}`)
    ),
    pageErrors: probes.flatMap((item) =>
      item.probe.pageErrors.map((error) => `${item.workerId}: ${error}`)
    ),
    network: probes.flatMap((item) =>
      item.probe.network.map((event) => ({
        worker_page_id: item.workerId,
        ...event,
      }))
    ),
    requestFailures: probes.flatMap((item) =>
      item.probe.requestFailures.map((event) => ({
        worker_page_id: item.workerId,
        ...event,
      }))
    ),
  };
}

async function attachFrontendArtifacts(
  testInfo: TestInfo,
  ctx: RuntimeContext,
  workers: CreatedWorker[],
  probe: PageProbe,
  extra: Record<string, unknown>
): Promise<void> {
  await attachJson(testInfo, 'frontend-connection-chaos.json', {
    startedAt: ctx.startedAt,
    workers,
    consoleLifecycle: probe.consoleLifecycle,
    consoleErrors: probe.consoleErrors,
    pageErrors: probe.pageErrors,
    network: probe.network,
    requestFailures: probe.requestFailures,
    ...extra,
  });
}

async function expectQrImage(
  imageRoot: Locator,
  timeoutMs: number
): Promise<void> {
  await expect(imageRoot).toBeVisible({ timeout: timeoutMs });
  const image = imageRoot.locator('img').first();

  await expect
    .poll(
      async () =>
        image
          .evaluate((node) => {
            const img = node as HTMLImageElement;
            const source = img.currentSrc || img.src;

            return (
              img.complete &&
              img.naturalWidth > 0 &&
              source.startsWith('data:image')
            );
          })
          .catch(() => false),
      { timeout: 10_000 }
    )
    .toBe(true);
}

async function installAuthenticatedStorage(
  page: Page,
  loginData: LoginResponse
): Promise<void> {
  await page.addInitScript((data) => {
    window.localStorage.setItem('token', data.token);
    window.localStorage.setItem('user', JSON.stringify(data.user));
    window.localStorage.setItem(
      'permissions',
      JSON.stringify(data.permissions ?? [])
    );
    window.localStorage.setItem('layout', JSON.stringify(data.layout ?? null));
    window.localStorage.setItem('sectors', JSON.stringify(data.sectors ?? []));
    window.localStorage.setItem(
      'channels',
      JSON.stringify(data.channels ?? [])
    );
    window.localStorage.setItem(
      'plan_is_active',
      JSON.stringify(data.plan_is_active ?? false)
    );
  }, loginData);
}

async function login(
  request: APIRequestContext,
  config: RuntimeConfig
): Promise<LoginResponse> {
  const response = await request.post(`${config.apiUrl}/auth/login`, {
    data: {
      login: config.login,
      password: config.password,
    },
    headers: {
      'Accept-Language': 'pt',
      'Content-Type': 'application/json',
      'X-Client-Platform': 'web',
    },
  });

  const data = await assertApiResponse<LoginResponse>(response, 'login');
  if (!data?.token || !data.user) {
    throw new Error('Login response did not include token and user data.');
  }

  return data;
}

async function assertApiResponse<T>(
  response: JsonResponseLike,
  label: string
): Promise<T> {
  const body = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok() || !body?.status) {
    throw new Error(
      `${label} failed with HTTP ${response.status()}: ${JSON.stringify(body)}`
    );
  }

  return body.data;
}

function readRuntimeConfig(): RuntimeConfig {
  return {
    apiUrl: normalizeBaseUrl(
      process.env.E2E_API_URL ?? 'http://localhost:3002/v1'
    ),
    login: requiredEnv('E2E_LOGIN'),
    password: requiredEnv('E2E_PASSWORD'),
    baseName:
      optionalEnv('E2E_FRONTEND_CONNECTION_BASE_NAME') ??
      `pw-front-${Date.now().toString(36)}`,
    qrMaxMs: readPositiveIntegerEnv('E2E_FRONTEND_QR_MAX_MS', 240_000),
    readyMaxMs: readPositiveIntegerEnv('E2E_FRONTEND_READY_MAX_MS', 180_000),
    stressWorkersPerType: readPositiveIntegerEnv(
      'E2E_FRONTEND_STRESS_WORKERS_PER_TYPE',
      1
    ),
    stressTypes: readStressTypes(),
  };
}

function readStressTypes(): WorkerTypeConfig[] {
  const raw = optionalEnv('E2E_FRONTEND_STRESS_TYPES') ?? 'wwebjs';
  return raw.split(',').map((value) => {
    const key = value.trim() as WorkerTypeKey;
    const type = WORKER_TYPES[key];
    if (!type) {
      throw new Error(`Unsupported E2E_FRONTEND_STRESS_TYPES entry: ${value}`);
    }
    return type;
  });
}

function createPool(): pg.Pool {
  const sslMode =
    optionalEnv('E2E_DB_SSLMODE') ?? optionalEnv('DB_SSLMODE') ?? 'false';

  return new Pool({
    host: requiredDbEnv('HOST'),
    port: Number(requiredDbEnv('PORT')),
    user: requiredDbEnv('USER'),
    password: requiredDbEnv('PASSWORD'),
    database: requiredDbEnv('DATABASE'),
    ssl:
      sslMode === 'true' || sslMode === 'require'
        ? { rejectUnauthorized: false }
        : false,
  });
}

function authHeaders(
  token: string,
  options: { json?: boolean } = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Accept-Language': 'pt',
    'X-Client-Platform': 'web',
  };

  if (options.json) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizePayload);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (['qrcode', 'qr', 'qr_code'].includes(key)) {
      const raw = typeof entry === 'string' ? entry : '';
      output.has_qr = raw.length > 0;
      output.qr_length = raw.length;
      output.qr_hash = raw ? hashString(raw) : undefined;
      continue;
    }
    if (key === 'pairing_code') {
      const raw = typeof entry === 'string' ? entry : '';
      output.has_pairing_code = raw.length > 0;
      output.pairing_code_length = raw.length;
      output.pairing_code_hash = raw ? hashString(raw) : undefined;
      continue;
    }
    output[key] = sanitizePayload(entry);
  }

  return output;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 12);
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

function requiredDbEnv(
  name: 'HOST' | 'PORT' | 'USER' | 'PASSWORD' | 'DATABASE'
): string {
  return (
    optionalEnv(`E2E_DB_${name}`) ??
    optionalEnv(`DB_${name}_RO`) ??
    optionalEnv(`DB_${name}`) ??
    requiredEnv(`E2E_DB_${name}`)
  );
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown
): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
}

function requireRuntime(): RuntimeContext {
  if (!runtime) {
    throw new Error('E2E runtime was not initialized.');
  }

  return runtime;
}
