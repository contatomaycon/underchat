import 'reflect-metadata';

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { execFile } from 'node:child_process';
import pg from 'pg';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

const { Pool } = pg;

const e2eEnabled = process.env.E2E_WWEBJS_AD_MESSAGE_ENABLED === 'true';
let runtime: RuntimeContext | undefined;

test.describe.serial('wwebjs ad message_edit intake', () => {
  test.skip(
    !e2eEnabled,
    'Set E2E_WWEBJS_AD_MESSAGE_ENABLED=true with API, DB, Kafka, web, and service_api running to execute this E2E test.'
  );

  test.beforeAll(async ({ request }) => {
    const config = readRuntimeConfig();
    const pool = createPool();
    const loginData = await login(request, config);
    const worker = await readWorkerFromDb(pool, config.workerId);

    if (!worker) {
      throw new Error(`Worker ${config.workerId} was not found in DB.`);
    }

    if (worker.deleted_at) {
      throw new Error(`Worker ${config.workerId} is deleted.`);
    }

    process.env.WORKER_ID = worker.worker_id;
    process.env.ACCOUNT_ID = worker.account_id;

    runtime = {
      config,
      loginData,
      pool,
      worker,
    };
  });

  test.afterAll(async () => {
    if (!runtime) {
      return;
    }

    await runtime.pool.end();
    runtime = undefined;
  });

  test('receives an ADS message_edit as a new chat message and renders it in the chat screen', async ({
    page,
    request,
  }, testInfo) => {
    const ctx = requireRuntime();
    const replay = createAdReplay(ctx);

    await test.step('replay the WWebJS event history in arrival order', async () => {
      const replayResult = await emitWwebjsAdHistory(ctx, replay);

      await attachJson(testInfo, 'wwebjs-ad-replay.json', {
        ...replayResult,
      });
    });

    const materialized =
      await test.step('wait for service_api to materialize the received message', async () =>
        waitForMaterializedAdMessage(request, ctx, replay));

    await attachJson(testInfo, 'wwebjs-ad-materialized-message.json', {
      chatId: materialized.chat.chat_id,
      chatStatus: materialized.chat.status,
      phone: materialized.chat.phone,
      messageId: materialized.message.message_id,
      messageKeyId: materialized.message.message_key?.id,
      content: materialized.message.content,
    });

    await test.step('open the chat UI and validate the rendered message', async () => {
      await openChatUiAndAssert(page, ctx, replay, materialized);
    });
  });
});

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

interface WorkerDbRow {
  worker_id: string;
  name: string;
  account_id: string;
  number: string | null;
  deleted_at: string | null;
}

interface RuntimeConfig {
  apiUrl: string;
  workerId: string;
  login: string;
  password: string;
  apiPollTimeoutMs: number;
  uiTimeoutMs: number;
  kafkaDeliveryTimeoutMs: number;
}

interface RuntimeContext {
  config: RuntimeConfig;
  pool: pg.Pool;
  loginData: LoginResponse;
  worker: WorkerDbRow;
}

interface ChatSearchResult {
  chat_id: string;
  phone?: string | null;
  status?: string | null;
  worker?: { id?: string | null; name?: string | null } | null;
  contact?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
    phone_ddi?: string | null;
  } | null;
  summary?: {
    last_message?: string | null;
    unread_count?: number | null;
  } | null;
}

interface ChatMessageResult {
  message_id: string;
  message_key?: {
    id?: string | null;
    remote_jid?: string | null;
    remote_jid_alt?: string | null;
    from_me?: boolean | null;
  } | null;
  content?: {
    type?: string | null;
    message?: string | null;
    context_info?: {
      external_ad_reply?: {
        title?: string | null;
        source_app?: string | null;
        source_url?: string | null;
        source_id?: string | null;
      } | null;
    } | null;
  } | null;
}

interface PaginatedResponse<T> {
  results: T[];
  pagings?: unknown;
  counts?: unknown;
}

interface MaterializedAdMessage {
  chat: ChatSearchResult;
  message: ChatMessageResult;
}

interface AdReplay {
  runId: string;
  phoneNumber: string;
  phoneJid: string;
  selfJid: string;
  lidJid: string;
  contactInfoTo: string;
  adMessageId: string;
  adSerializedId: string;
  adBody: string;
  adTitle: string;
  adDescription: string;
  adGreeting: string;
  e2eSerializedId: string;
  contactCardSerializedId: string;
  historySequence: number[];
}

async function emitWwebjsAdHistory(
  ctx: RuntimeContext,
  replay: AdReplay
): Promise<Record<string, unknown>> {
  const stdout = await runEmitterProcess(ctx, replay);
  const output = stdout.trim();
  if (!output) {
    throw new Error('WWebJS ad emitter did not return a replay summary.');
  }

  return JSON.parse(output) as Record<string, unknown>;
}

function runEmitterProcess(
  ctx: RuntimeContext,
  replay: AdReplay
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'pnpm',
      [
        'exec',
        'tsx',
        '--import',
        'reflect-metadata',
        'packages/tests/e2e/helpers/wwebjsAdMessageEmitter.ts',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WORKER_ID: ctx.worker.worker_id,
          ACCOUNT_ID: ctx.worker.account_id,
          E2E_WWEBJS_AD_REPLAY: JSON.stringify(replay),
          E2E_WWEBJS_AD_KAFKA_TIMEOUT_MS: String(
            ctx.config.kafkaDeliveryTimeoutMs
          ),
        },
        timeout: ctx.config.kafkaDeliveryTimeoutMs + 30_000,
        maxBuffer: 1024 * 1024 * 20,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `WWebJS ad emitter failed: ${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`
            )
          );
          return;
        }

        resolve(stdout);
      }
    );
  });
}

async function waitForMaterializedAdMessage(
  request: APIRequestContext,
  ctx: RuntimeContext,
  replay: AdReplay
): Promise<MaterializedAdMessage> {
  const deadline = Date.now() + ctx.config.apiPollTimeoutMs;
  let lastError: string | undefined;
  let lastChat: ChatSearchResult | undefined;

  while (Date.now() < deadline) {
    try {
      const chat = await findChatByPhone(request, ctx, replay);
      if (chat) {
        lastChat = chat;
        const messages = await listChatMessages(request, ctx, chat.chat_id);
        const message = messages.find(
          (candidate) =>
            candidate.message_key?.id === replay.adSerializedId &&
            candidate.message_key?.remote_jid === replay.phoneJid &&
            candidate.message_key?.remote_jid_alt === replay.lidJid
        );

        if (
          message?.content?.type === 'text' &&
          message.content.message === replay.adBody &&
          message.content.context_info?.external_ad_reply?.title ===
            replay.adTitle
        ) {
          return { chat, message };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(1_000);
  }

  throw new Error(
    `Timed out waiting for WWebJS ad message ${replay.adSerializedId}. Last chat: ${JSON.stringify(
      lastChat
    )}. Last error: ${lastError ?? 'none'}`
  );
}

async function findChatByPhone(
  request: APIRequestContext,
  ctx: RuntimeContext,
  replay: AdReplay
): Promise<ChatSearchResult | null> {
  const response = await request.get(`${ctx.config.apiUrl}/chat/search`, {
    headers: authHeaders(ctx.loginData.token),
    params: {
      current_page: 1,
      per_page: 50,
      search: replay.phoneNumber,
      filter_worker_id: ctx.config.workerId,
    },
  });

  const data = await assertApiResponse<PaginatedResponse<ChatSearchResult>>(
    response,
    'chat search'
  );

  const phoneDigits = replay.phoneNumber.replaceAll(/\D/g, '');

  return (
    data.results.find((chat) => {
      const chatPhone = `${chat.phone ?? ''}${chat.contact?.phone ?? ''}`;
      const chatPhoneDigits = chatPhone.replaceAll(/\D/g, '');

      return (
        chat.worker?.id === ctx.config.workerId &&
        chatPhoneDigits.includes(phoneDigits)
      );
    }) ?? null
  );
}

async function listChatMessages(
  request: APIRequestContext,
  ctx: RuntimeContext,
  chatId: string
): Promise<ChatMessageResult[]> {
  const response = await request.get(
    `${ctx.config.apiUrl}/chat/${encodeURIComponent(chatId)}`,
    {
      headers: authHeaders(ctx.loginData.token),
      params: {
        current_page: 1,
        per_page: 20,
      },
    }
  );

  const data = await assertApiResponse<PaginatedResponse<ChatMessageResult>>(
    response,
    'chat messages'
  );

  return data.results;
}

async function openChatUiAndAssert(
  page: Page,
  ctx: RuntimeContext,
  replay: AdReplay,
  materialized: MaterializedAdMessage
): Promise<void> {
  await installAuthenticatedStorage(page, ctx.loginData);
  await page.goto('/chat');

  const searchInput = page
    .locator('.chat-list-search input, input#search')
    .first();
  await expect(searchInput).toBeVisible({ timeout: ctx.config.uiTimeoutMs });

  const searchResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/chat/search'),
      { timeout: ctx.config.uiTimeoutMs }
    )
    .catch(() => null);

  await searchInput.fill(replay.phoneNumber);
  await searchResponsePromise;

  const chatCard = page.locator('.chat-list .chat').first();
  await expect(chatCard).toBeVisible({ timeout: ctx.config.uiTimeoutMs });
  await expect(chatCard).toContainText(replay.phoneNumber.slice(-4));

  const messagesResponsePromise = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response
          .url()
          .includes(`/chat/${encodeURIComponent(materialized.chat.chat_id)}`),
      { timeout: ctx.config.uiTimeoutMs }
    )
    .catch(() => null);

  await chatCard.click();
  await messagesResponsePromise;

  const renderedMessage = page.locator(
    `[data-message-id="${cssAttributeValue(materialized.message.message_id)}"]`
  );
  await expect(renderedMessage).toBeVisible({
    timeout: ctx.config.uiTimeoutMs,
  });
  await expect(renderedMessage).toContainText(replay.adBody);
  await expect(renderedMessage).toContainText(replay.adTitle);
}

function createAdReplay(ctx: RuntimeContext): AdReplay {
  const runId = optionalEnv('E2E_WWEBJS_AD_RUN_ID') ?? Date.now().toString(36);
  const phoneNumber =
    optionalEnv('E2E_WWEBJS_AD_PHONE')?.replaceAll(/\D/g, '') ??
    `556999${Date.now().toString().slice(-6)}`;
  const selfPhone =
    optionalEnv('E2E_WWEBJS_SELF_PHONE')?.replaceAll(/\D/g, '') ??
    ctx.worker.number?.replaceAll(/\D/g, '') ??
    '5517991552458';
  const lidDigits =
    optionalEnv('E2E_WWEBJS_AD_LID')?.replaceAll(/\D/g, '') ??
    `635289${Date.now().toString().slice(-7)}`;
  const lidJid = `${lidDigits}@lid`;
  const messageSuffix = runId.replaceAll(/[^a-zA-Z0-9]/g, '').toUpperCase();

  return {
    runId,
    phoneNumber,
    phoneJid: `${phoneNumber}@s.whatsapp.net`,
    selfJid: `${selfPhone}@c.us`,
    lidJid,
    contactInfoTo: `${Date.now().toString().slice(-15)}:15@lid`,
    adMessageId: `3A7E64CFE62F${messageSuffix}`,
    adSerializedId: `false_${lidJid}_3A7E64CFE62F${messageSuffix}`,
    adBody: optionalEnv('E2E_WWEBJS_AD_BODY') ?? `Mensagem de anúncio ${runId}`,
    adTitle: optionalEnv('E2E_WWEBJS_AD_TITLE') ?? `Anúncio de teste ${runId}`,
    adDescription:
      optionalEnv('E2E_WWEBJS_AD_DESCRIPTION') ??
      `Descrição de anúncio ${runId}`,
    adGreeting:
      optionalEnv('E2E_WWEBJS_AD_GREETING') ?? `Saudação de anúncio ${runId}`,
    e2eSerializedId: `false_${lidJid}_3EB086C68C75${messageSuffix}`,
    contactCardSerializedId: `false_${lidJid}_3EB0FA10AEA0${messageSuffix}`,
    historySequence: [
      9272, 9273, 9274, 9275, 9276, 9277, 9278, 9279, 9280, 9282, 9325, 9326,
      9327, 2886, 2887, 2888, 2889, 2890, 2891, 2892,
    ],
  };
}

function readRuntimeConfig(): RuntimeConfig {
  return {
    apiUrl: normalizeBaseUrl(
      process.env.E2E_API_URL ?? 'http://localhost:3002/v1'
    ),
    workerId: requiredEnv('E2E_WORKER_ID'),
    login: requiredEnv('E2E_LOGIN'),
    password: requiredEnv('E2E_PASSWORD'),
    apiPollTimeoutMs: readPositiveIntegerEnv(
      'E2E_WWEBJS_AD_API_TIMEOUT_MS',
      60_000
    ),
    uiTimeoutMs: readPositiveIntegerEnv('E2E_WWEBJS_AD_UI_TIMEOUT_MS', 30_000),
    kafkaDeliveryTimeoutMs: readPositiveIntegerEnv(
      'E2E_WWEBJS_AD_KAFKA_TIMEOUT_MS',
      30_000
    ),
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

async function readWorkerFromDb(
  pool: pg.Pool,
  workerId: string
): Promise<WorkerDbRow | null> {
  const result = await pool.query<WorkerDbRow>(
    `
      select
        w.worker_id,
        w.name,
        w.account_id,
        w.number,
        w.deleted_at
      from worker w
      where w.worker_id = $1
      limit 1
    `,
    [workerId]
  );

  return result.rows[0] ?? null;
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

function cssAttributeValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
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
