/* eslint-disable no-use-before-define */
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

const { Pool } = pg;

const WORKER_STATUS = {
  online: '019a930d-c6f6-766d-9c84-30af6ecc33b2',
  offline: '019a930d-c6f6-766d-9c84-3696c2cd5ed8',
  disponible: '019a930d-c6f6-766d-9c84-3904383fe742',
  recreating: '019a930d-c6f6-766d-9c84-46093814d8e0',
  error: '019a930d-c6f6-766d-9c84-48cb970a9f21',
  mismatched: '019a930d-c6f6-766d-9c84-5056ccf66633',
  stopped: '019bcd18-ce66-77a2-9d7c-e48159c253da',
};

const CONNECTION_TYPES = [
  {
    key: 'whatsmeow',
    id: 'e80ad183-2b46-4628-9105-a036f2d28720',
  },
  {
    key: 'baileys',
    id: '019a930d-c6f6-766d-9c84-53307d4159a1',
  },
  {
    key: 'wwebjs',
    id: '019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
  },
] as const;

const READY_STATUS_IDS = new Set<string>([
  WORKER_STATUS.disponible,
  WORKER_STATUS.offline,
  WORKER_STATUS.mismatched,
]);

type ConnectionType = (typeof CONNECTION_TYPES)[number];

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
  user: unknown;
  permissions?: string[];
  layout?: unknown;
  sectors?: string[];
  channels?: unknown[];
  plan_is_active?: boolean;
}

interface WorkerApiView {
  id: string;
  name: string;
  number: string | null;
  status: { id: string; name: string | null } | null;
  type: { id: string; name: string | null } | null;
}

interface ExternalConnectionLink {
  token: string;
  url: string;
  expires_at: string;
}

interface WorkerDbRow {
  worker_id: string;
  name: string;
  worker_status_id: string;
  worker_status: string | null;
  worker_type_id: string;
  worker_type: string | null;
  server_id: string;
  account_id: string;
  number: string | null;
  container_id: string | null;
  connection_date: string | null;
  deleted_at: string | null;
}

interface RuntimeConfig {
  apiUrl: string;
  workerId: string;
  workerName: string;
  login: string;
  password: string;
  typePatchMaxMs: number;
  connectAckMaxMs: number;
  typeReadyMaxMs: number;
  qrMaxMs: number;
}

interface RuntimeContext {
  config: RuntimeConfig;
  pool: pg.Pool;
  loginData: LoginResponse;
  originalWorker: WorkerDbRow;
}

const e2eEnabled = process.env.E2E_CONNECTIONS_ENABLED === 'true';
let runtime: RuntimeContext | undefined;

test.describe.serial('worker channel connections', () => {
  test.skip(
    !e2eEnabled,
    'Set E2E_CONNECTIONS_ENABLED=true and provide E2E_* variables to run connection E2E tests.'
  );

  test.beforeAll(async ({ request }) => {
    const config = readRuntimeConfig();
    const pool = createPool();
    const loginData = await login(request, config);
    const originalWorker = await readWorkerFromDb(pool, config.workerId);

    if (!originalWorker) {
      throw new Error(`Worker ${config.workerId} was not found in DB.`);
    }

    assertDisposableWorker(originalWorker, config);
    runtime = {
      config,
      pool,
      loginData,
      originalWorker,
    };
  });

  test.afterAll(async ({ request }) => {
    if (!runtime) {
      return;
    }

    try {
      await restoreOriginalWorkerType(request, runtime);
    } finally {
      await runtime.pool.end();
    }
  });

  for (const connectionType of CONNECTION_TYPES) {
    test(`opens a QR code for ${connectionType.key}`, async ({
      page,
      request,
    }, testInfo) => {
      const ctx = requireRuntime();

      await test.step(`switch channel to ${connectionType.key}`, async () => {
        await ensureWorkerTypeThroughUi(page, ctx, connectionType, testInfo);
      });

      await test.step(`connect ${connectionType.key} and wait for QR`, async () => {
        await connectChannelAndExpectQr(
          page,
          request,
          ctx,
          connectionType,
          testInfo
        );
      });
    });
  }

  test('opens a QR code through the external connection link', async ({
    page,
    request,
  }, testInfo) => {
    const ctx = requireRuntime();
    const link = await createExternalConnectionLink(request, ctx);
    const requestUrlPart = `/worker/external-connection/${encodeURIComponent(
      link.token
    )}/qrcode`;

    const qrRequestPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(requestUrlPart),
      { timeout: ctx.config.qrMaxMs }
    );

    const startedAt = Date.now();
    await page.goto(`/connection/external/${encodeURIComponent(link.token)}`);
    await expect(page.getByTestId('external-connection-page')).toBeVisible();

    const qrRequestResponse = await qrRequestPromise;
    const ackMs = Date.now() - startedAt;
    await assertApiResponse<null>(qrRequestResponse, 'external QR request');
    expect(ackMs).toBeLessThanOrEqual(ctx.config.connectAckMaxMs);

    await expectQrImage(
      page.getByTestId('external-connection-qr-image'),
      ctx.config.qrMaxMs - ackMs
    );

    await attachJson(testInfo, 'external-connection-timings.json', {
      ackMs,
      qrMs: Date.now() - startedAt,
      tokenExpiresAt: link.expires_at,
    });
  });
});

function readRuntimeConfig(): RuntimeConfig {
  return {
    apiUrl: normalizeBaseUrl(
      process.env.E2E_API_URL ?? 'http://localhost:3002/v1'
    ),
    workerId: requiredEnv('E2E_WORKER_ID'),
    workerName: requiredEnv('E2E_WORKER_NAME'),
    login: requiredEnv('E2E_LOGIN'),
    password: requiredEnv('E2E_PASSWORD'),
    typePatchMaxMs: readPositiveIntegerEnv('E2E_TYPE_PATCH_MAX_MS', 3_000),
    connectAckMaxMs: readPositiveIntegerEnv('E2E_CONNECT_ACK_MAX_MS', 3_000),
    typeReadyMaxMs: readPositiveIntegerEnv('E2E_TYPE_READY_MAX_MS', 60_000),
    qrMaxMs: readPositiveIntegerEnv('E2E_QR_MAX_MS', 30_000),
  };
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

async function ensureWorkerTypeThroughUi(
  page: Page,
  ctx: RuntimeContext,
  connectionType: ConnectionType,
  testInfo: TestInfo
): Promise<void> {
  const currentWorker = await readRequiredWorkerFromDb(ctx);

  if (currentWorker.worker_type_id === connectionType.id) {
    await waitForWorkerReady(ctx, connectionType);
    await attachJson(testInfo, `${connectionType.key}-type-switch.json`, {
      skipped: true,
      reason: 'Worker already has target type.',
    });
    return;
  }

  await openChannelsPageForWorker(page, ctx);
  await page.getByTestId(`channel-edit-${ctx.config.workerId}`).click();
  await expect(page.getByTestId('edit-channel-dialog')).toBeVisible();
  await page.getByTestId('edit-channel-type-select').click();
  await page
    .getByTestId(`edit-channel-type-option-${connectionType.id}`)
    .click();

  const patchResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes(`/worker/${ctx.config.workerId}/`),
    { timeout: ctx.config.typePatchMaxMs + 5_000 }
  );
  const patchStartedAt = Date.now();

  await page.getByTestId('edit-channel-save').click();

  const patchResponse = await patchResponsePromise;
  const patchMs = Date.now() - patchStartedAt;
  await assertApiResponse<boolean>(patchResponse, 'worker type update');
  expect(patchMs).toBeLessThanOrEqual(ctx.config.typePatchMaxMs);
  await expect(page.getByTestId('edit-channel-dialog')).toBeHidden({
    timeout: 5_000,
  });

  const readyWorker = await waitForWorkerReady(ctx, connectionType);
  await attachJson(testInfo, `${connectionType.key}-type-switch.json`, {
    skipped: false,
    patchMs,
    status: readyWorker.worker_status,
    containerId: readyWorker.container_id,
  });
}

async function connectChannelAndExpectQr(
  page: Page,
  request: APIRequestContext,
  ctx: RuntimeContext,
  connectionType: ConnectionType,
  testInfo: TestInfo
): Promise<void> {
  await openChannelsPageForWorker(page, ctx);
  await assertWorkerApiView(request, ctx, connectionType);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/worker/whatsapp/unofficial'),
    { timeout: ctx.config.connectAckMaxMs + 5_000 }
  );

  const startedAt = Date.now();
  await page.getByTestId(`channel-connect-${ctx.config.workerId}`).click();
  await expect(page.getByTestId('connection-dialog')).toBeVisible({
    timeout: 3_000,
  });

  const response = await responsePromise;
  const ackMs = Date.now() - startedAt;
  await assertApiResponse<boolean>(response, 'connection request');
  expect(ackMs).toBeLessThanOrEqual(ctx.config.connectAckMaxMs);

  await expectQrImage(
    page.getByTestId('connection-qr-image'),
    ctx.config.qrMaxMs - ackMs
  );

  await attachJson(testInfo, `${connectionType.key}-connection-timings.json`, {
    ackMs,
    qrMs: Date.now() - startedAt,
    workerType: connectionType.key,
  });
}

async function openChannelsPageForWorker(
  page: Page,
  ctx: RuntimeContext
): Promise<void> {
  await installAuthenticatedStorage(page, ctx.loginData);
  await page.goto('/channels');

  const searchInput = page.getByTestId('channels-search').locator('input');
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await searchInput.fill(ctx.config.workerName);
  await expect(
    page.getByTestId(`channel-connect-${ctx.config.workerId}`)
  ).toBeVisible({
    timeout: 30_000,
  });
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

async function assertWorkerApiView(
  request: APIRequestContext,
  ctx: RuntimeContext,
  connectionType: ConnectionType
): Promise<void> {
  const response = await request.get(
    `${ctx.config.apiUrl}/worker/${ctx.config.workerId}`,
    {
      headers: authHeaders(ctx.loginData.token),
    }
  );
  const worker = await assertApiResponse<WorkerApiView>(
    response,
    'worker view'
  );

  expect(worker.id).toBe(ctx.config.workerId);
  expect(worker.name).toBe(ctx.config.workerName);
  expect(worker.type?.id).toBe(connectionType.id);
  expect(worker.status?.id).not.toBe(WORKER_STATUS.online);
}

async function createExternalConnectionLink(
  request: APIRequestContext,
  ctx: RuntimeContext
): Promise<ExternalConnectionLink> {
  const response = await request.post(
    `${ctx.config.apiUrl}/worker/${ctx.config.workerId}/external-connection-link`,
    {
      data: {},
      headers: authHeaders(ctx.loginData.token),
    }
  );

  const link = await assertApiResponse<ExternalConnectionLink>(
    response,
    'external connection link'
  );
  if (!link?.token) {
    throw new Error('External connection link response did not include token.');
  }

  return link;
}

async function restoreOriginalWorkerType(
  request: APIRequestContext,
  ctx: RuntimeContext
): Promise<void> {
  const currentWorker = await readWorkerFromDb(ctx.pool, ctx.config.workerId);
  if (
    !currentWorker ||
    currentWorker.worker_type_id === ctx.originalWorker.worker_type_id
  ) {
    return;
  }

  const response = await request.patch(
    `${ctx.config.apiUrl}/worker/${encodeURIComponent(
      ctx.config.workerId
    )}/${encodeURIComponent(ctx.config.workerName)}`,
    {
      data: {
        worker_type: ctx.originalWorker.worker_type_id,
      },
      headers: authHeaders(ctx.loginData.token),
    }
  );
  await assertApiResponse<boolean>(response, 'restore original worker type');
  await waitForWorkerTypeId(ctx, ctx.originalWorker.worker_type_id);
}

async function waitForWorkerReady(
  ctx: RuntimeContext,
  connectionType: ConnectionType
): Promise<WorkerDbRow> {
  return waitForWorkerTypeId(ctx, connectionType.id);
}

async function waitForWorkerTypeId(
  ctx: RuntimeContext,
  typeId: string
): Promise<WorkerDbRow> {
  const deadline = Date.now() + ctx.config.typeReadyMaxMs;
  let lastWorker: WorkerDbRow | null = null;

  while (Date.now() < deadline) {
    lastWorker = await readWorkerFromDb(ctx.pool, ctx.config.workerId);

    if (
      lastWorker?.worker_type_id === typeId &&
      READY_STATUS_IDS.has(lastWorker.worker_status_id)
    ) {
      return lastWorker;
    }

    if (lastWorker?.worker_status_id === WORKER_STATUS.error) {
      throw new Error(
        `Worker ${ctx.config.workerId} reached error status while waiting for type ${typeId}.`
      );
    }

    await delay(1_000);
  }

  throw new Error(
    `Worker ${ctx.config.workerId} did not become ready with type ${typeId}. Last state: ${JSON.stringify(
      lastWorker
    )}`
  );
}

async function readRequiredWorkerFromDb(
  ctx: RuntimeContext
): Promise<WorkerDbRow> {
  const worker = await readWorkerFromDb(ctx.pool, ctx.config.workerId);
  if (!worker) {
    throw new Error(`Worker ${ctx.config.workerId} was not found in DB.`);
  }

  return worker;
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
        w.server_id,
        w.account_id,
        w.number,
        w.container_id,
        w.connection_date,
        w.deleted_at
      from worker w
      left join worker_status ws on ws.worker_status_id = w.worker_status_id
      left join worker_type wt on wt.worker_type_id = w.worker_type_id
      where w.worker_id = $1
      limit 1
    `,
    [workerId]
  );

  return result.rows[0] ?? null;
}

function assertDisposableWorker(
  worker: WorkerDbRow,
  config: RuntimeConfig
): void {
  const issues: string[] = [];

  if (worker.deleted_at) {
    issues.push('worker is deleted');
  }

  if (worker.name !== config.workerName) {
    issues.push(`worker name is ${worker.name}, expected ${config.workerName}`);
  }

  if (worker.worker_status_id === WORKER_STATUS.online) {
    issues.push('worker is online');
  }

  if (worker.worker_status_id === WORKER_STATUS.stopped) {
    issues.push('worker is stopped');
  }

  if (worker.number) {
    issues.push(`worker has a connected number (${worker.number})`);
  }

  if (issues.length > 0) {
    throw new Error(
      `Connection E2E requires a disposable disconnected worker. Issues: ${issues.join(
        '; '
      )}`
    );
  }
}

async function expectQrImage(
  imageRoot: Locator,
  timeoutMs: number
): Promise<void> {
  const timeout = Math.max(timeoutMs, 1_000);
  await expect(imageRoot).toBeVisible({ timeout });
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
      { timeout: 5_000 }
    )
    .toBe(true);
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

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Accept-Language': 'pt',
    'Content-Type': 'application/json',
    'X-Client-Platform': 'web',
  };
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
