import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

interface ApiEnvelope<T> {
  status: boolean;
  message?: string;
  data: T;
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

interface RuntimeConfig {
  apiUrl: string;
  chatbotId: string;
  login: string;
  password: string;
}

interface RuntimeContext {
  config: RuntimeConfig;
  loginData: LoginResponse;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const chatbotFlowEnabled = process.env.E2E_CHATBOT_FLOW_ENABLED === 'true';
const hasRequiredRuntime = [
  process.env.E2E_CHATBOT_FLOW_CHATBOT_ID,
  process.env.E2E_LOGIN,
  process.env.E2E_PASSWORD,
].every((value) => Boolean(value?.trim()));

let runtime: RuntimeContext | undefined;

test.describe.serial('chatbot flow node palette', () => {
  test.skip(
    !chatbotFlowEnabled || !hasRequiredRuntime,
    'Set E2E_CHATBOT_FLOW_ENABLED=true plus E2E_CHATBOT_FLOW_CHATBOT_ID, E2E_LOGIN, and E2E_PASSWORD. This suite only reads an existing chatbot flow and never saves it.'
  );

  test.beforeAll(async ({ request }) => {
    const config = readRuntimeConfig();
    runtime = {
      config,
      loginData: await login(request, config),
    };
  });

  test('shows a filterable two-column palette on desktop', async ({ page }) => {
    await openChatbotFlow(page, requireRuntime(), {
      width: 1440,
      height: 1000,
    });

    const palette = page.getByTestId('chatbot-node-palette');
    const messageCard = page.getByTestId('chatbot-node-palette-card-message');
    const redirectCard = page.getByTestId('chatbot-node-palette-card-redirect');

    await expect(palette).toBeVisible();
    await expect(messageCard).toBeVisible();
    await expect(redirectCard).toBeVisible();

    await page.getByTestId('chatbot-node-palette-category-attendance').click();
    await expect(messageCard).toBeHidden();
    await expect(redirectCard).toBeVisible();

    await page
      .getByTestId('chatbot-node-palette-category-conversation')
      .click();
    await expect(messageCard).toBeVisible();
    await expect(redirectCard).toBeHidden();

    const messageLabel = await messageCard.getAttribute('title');
    if (!messageLabel) {
      throw new Error('The Message palette card does not expose its label.');
    }

    const search = page.getByTestId('chatbot-node-palette-search');
    await search.fill('__palette_e2e_no_match__');
    await expect(page.getByTestId('chatbot-node-palette-empty')).toBeVisible();
    await search.fill(messageLabel);
    await expect(messageCard).toBeVisible();
  });

  test('drags, minimizes, restores, and persists palette preferences', async ({
    page,
  }) => {
    await openChatbotFlow(page, requireRuntime(), {
      width: 1440,
      height: 1000,
    });

    const palette = page.getByTestId('chatbot-node-palette');
    const handle = page.getByTestId('chatbot-node-palette-drag-handle');
    const initialBox = await boxOf(palette, 'desktop palette');
    const handleBox = await boxOf(handle, 'palette drag handle');

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 140,
      handleBox.y + handleBox.height / 2 + 42,
      { steps: 12 }
    );
    await page.mouse.up();

    const movedBox = await boxOf(palette, 'moved desktop palette');
    expect(movedBox.x).toBeGreaterThan(initialBox.x + 80);

    await page.getByTestId('chatbot-node-palette-minimize').click();
    await expect(
      page.getByTestId('chatbot-node-palette-restore')
    ).toBeVisible();
    await expect(palette).toBeHidden();

    await reloadChatbotFlow(page, requireRuntime().config.chatbotId);
    await expect(
      page.getByTestId('chatbot-node-palette-restore')
    ).toBeVisible();
    await expect(palette).toBeHidden();

    await page.getByTestId('chatbot-node-palette-restore').click();
    await expect(palette).toBeVisible();

    const restoredBox = await boxOf(palette, 'restored desktop palette');
    expect(Math.abs(restoredBox.x - movedBox.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(restoredBox.y - movedBox.y)).toBeLessThanOrEqual(8);
  });

  test('creates local nodes by click and native card drag without saving', async ({
    page,
  }) => {
    await openChatbotFlow(page, requireRuntime(), {
      width: 1440,
      height: 1000,
    });

    const canvas = page.getByTestId('chatbot-flow-canvas');
    const messageNodes = canvas.locator('.chatbot-message-node');
    const messageCount = await messageNodes.count();

    await page.getByTestId('chatbot-node-palette-card-message').click();
    await expect(messageNodes).toHaveCount(messageCount + 1);

    const annotationNodes = canvas.locator('.chatbot-annotation-node');
    const annotationCount = await annotationNodes.count();
    const flow = canvas.locator('.vue-flow');
    const flowBox = await boxOf(flow, 'Vue Flow canvas');

    await page
      .getByTestId('chatbot-node-palette-card-annotation')
      .dragTo(flow, {
        targetPosition: {
          x: Math.round(flowBox.width * 0.72),
          y: Math.round(flowBox.height * 0.64),
        },
      });

    await expect(annotationNodes).toHaveCount(annotationCount + 1);
  });

  test('uses the compact mobile palette without a floating drag handle', async ({
    page,
  }) => {
    await openChatbotFlow(page, requireRuntime(), { width: 390, height: 844 });

    const canvas = page.getByTestId('chatbot-flow-canvas');
    const palette = page.getByTestId('chatbot-node-palette');
    const menuCard = page.getByTestId('chatbot-node-palette-card-menu');
    const satisfactionCard = page.getByTestId(
      'chatbot-node-palette-card-satisfaction'
    );

    await expect(palette).toBeVisible();
    await expect(
      page.getByTestId('chatbot-node-palette-drag-handle')
    ).toHaveCount(0);
    await expect(menuCard).toBeVisible();
    await expect(satisfactionCard).toBeVisible();

    const [canvasBox, paletteBox, menuBox, satisfactionBox] = await Promise.all(
      [
        boxOf(canvas, 'mobile flow canvas'),
        boxOf(palette, 'mobile palette'),
        boxOf(menuCard, 'mobile menu card'),
        boxOf(satisfactionCard, 'mobile satisfaction card'),
      ]
    );

    expect(paletteBox.width).toBeLessThanOrEqual(canvasBox.width);
    expect(paletteBox.y + paletteBox.height).toBeGreaterThanOrEqual(
      canvasBox.y + canvasBox.height - 12
    );
    expect(Math.abs(menuBox.y - satisfactionBox.y)).toBeLessThanOrEqual(4);
    expect(satisfactionBox.x).toBeGreaterThan(menuBox.x + 8);

    await page.getByTestId('chatbot-node-palette-minimize').click();
    await expect(
      page.getByTestId('chatbot-node-palette-restore')
    ).toBeVisible();
    await page.getByTestId('chatbot-node-palette-restore').click();
    await expect(palette).toBeVisible();
  });
});

function readRuntimeConfig(): RuntimeConfig {
  return {
    apiUrl: normalizeBaseUrl(
      process.env.E2E_API_URL ?? 'http://localhost:3002/v1'
    ),
    chatbotId: requiredEnv('E2E_CHATBOT_FLOW_CHATBOT_ID'),
    login: requiredEnv('E2E_LOGIN'),
    password: requiredEnv('E2E_PASSWORD'),
  };
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

  if (!response.ok()) {
    throw new Error(`Login failed with HTTP ${response.status()}.`);
  }

  const envelope = (await response.json()) as ApiEnvelope<LoginResponse>;
  if (!envelope.status || !envelope.data?.token || !envelope.data.user) {
    throw new Error(envelope.message || 'Login did not return token and user.');
  }

  return envelope.data;
}

async function openChatbotFlow(
  page: Page,
  ctx: RuntimeContext,
  viewport: { width: number; height: number }
): Promise<void> {
  await page.setViewportSize(viewport);
  await installAuthenticatedStorage(page, ctx.loginData);

  const flowResponse = waitForChatbotFlow(page, ctx.config.chatbotId);
  await page.goto(`/chatbot-flow/${encodeURIComponent(ctx.config.chatbotId)}`);
  expect((await flowResponse).ok()).toBe(true);

  await expect(page.getByTestId('chatbot-flow-canvas')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('chatbot-node-palette')).toBeVisible({
    timeout: 30_000,
  });
}

async function reloadChatbotFlow(page: Page, chatbotId: string): Promise<void> {
  const flowResponse = waitForChatbotFlow(page, chatbotId);
  await page.reload();
  expect((await flowResponse).ok()).toBe(true);
  await expect(page.getByTestId('chatbot-flow-canvas')).toBeVisible({
    timeout: 30_000,
  });
}

function waitForChatbotFlow(page: Page, chatbotId: string) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false;

    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/chatbot/flow') &&
      url.searchParams.get('chatbot_id') === chatbotId
    );
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

async function boxOf(locator: Locator, name: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${name} did not produce a layout box.`);
  }

  return box;
}

function requireRuntime(): RuntimeContext {
  if (!runtime) {
    throw new Error('E2E runtime was not initialized.');
  }

  return runtime;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
