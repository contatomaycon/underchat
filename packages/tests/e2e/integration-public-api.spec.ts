import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

interface LoginResponse {
  token: string;
  user: {
    account_id: string;
    info?: {
      name?: string;
      last_name?: string;
    };
  };
  permissions?: string[];
  layout?: unknown;
  sectors?: string[];
  channels?: unknown[];
  plan_is_active?: boolean;
}

interface RuntimeConfig {
  apiUrl: string;
  login: string;
  password: string;
  disposableAccountId?: string;
}

interface RuntimeContext {
  config: RuntimeConfig;
  loginData: LoginResponse;
}

interface ApiEnvelope<T> {
  status: boolean;
  message?: string;
  data: T;
}

const integrationUiEnabled = process.env.E2E_INTEGRATION_UI_ENABLED === 'true';
const tokenMutationEnabled =
  process.env.E2E_PUBLIC_API_TOKEN_MUTATION_ENABLED === 'true';

let runtime: RuntimeContext | undefined;

test.describe.serial('integration page and public API token', () => {
  test.skip(
    !integrationUiEnabled,
    'Set E2E_INTEGRATION_UI_ENABLED=true and provide E2E_LOGIN/E2E_PASSWORD to run integration UI tests.'
  );

  test.beforeAll(async ({ request }) => {
    const config = readRuntimeConfig();
    runtime = {
      config,
      loginData: await login(request, config),
    };
  });

  test('shows API first and inbound webhooks second', async ({ page }) => {
    const ctx = requireRuntime();
    await openIntegrationPage(page, ctx.loginData);

    const publicApiCard = page.getByTestId('public-api-token-card');
    const webhookCard = page.getByTestId('webhook-integrations-card');

    await expect(publicApiCard).toBeVisible();
    await expect(webhookCard).toBeVisible();
    await expect(publicApiCard).toContainText('API pública');
    await expect(publicApiCard).toContainText(
      'chats, etiquetas, setores e usuários'
    );
    await expect(publicApiCard).toContainText('keyapi');
    await expect(publicApiCard).toContainText('x-underchat-user-id');
    await expect(publicApiCard).toContainText(
      'A chave identifica a conta; este UUID define quem executa a operação.'
    );
    const documentationLink = publicApiCard.getByTestId('public-api-open-docs');
    await expect(documentationLink).toHaveAttribute('href', /^(https?:)?\/\//);
    await expect(documentationLink).toHaveAttribute('target', '_blank');
    await expect(documentationLink).toBeEnabled();
    await documentationLink.click({ trial: true });
    await expect(webhookCard).toContainText('Webhooks de entrada');
    await expect(webhookCard).toContainText('CRM e automações');
    await expect(
      webhookCard.getByLabel('Etapas para configurar um webhook')
    ).toContainText(/Criar[\s\S]*Enviar amostra[\s\S]*Mapear[\s\S]*Ativar/);

    const [apiBox, webhookBox] = await Promise.all([
      publicApiCard.boundingBox(),
      webhookCard.boundingBox(),
    ]);
    expect(apiBox).not.toBeNull();
    expect(webhookBox).not.toBeNull();
    if (!apiBox || !webhookBox) {
      throw new Error('Integration cards did not produce layout boxes.');
    }
    expect(webhookBox.y).toBeGreaterThan(apiBox.y + apiBox.height - 2);
  });

  test('keeps both cards usable on a narrow viewport', async ({ page }) => {
    const ctx = requireRuntime();
    await page.setViewportSize({ width: 390, height: 844 });
    await openIntegrationPage(page, ctx.loginData);

    const publicApiCard = page.getByTestId('public-api-token-card');
    const webhookCard = page.getByTestId('webhook-integrations-card');
    await expect(publicApiCard).toBeVisible();
    await expect(webhookCard).toBeVisible();

    const endpointPanel = publicApiCard.locator('.public-api-panel--endpoint');
    const credentialPanel = publicApiCard.locator(
      '.public-api-panel--credential'
    );
    await expect(endpointPanel).toBeVisible();
    await expect(credentialPanel).toBeVisible();

    const [endpointBox, credentialBox] = await Promise.all([
      endpointPanel.boundingBox(),
      credentialPanel.boundingBox(),
    ]);
    expect(endpointBox).not.toBeNull();
    expect(credentialBox).not.toBeNull();
    if (!endpointBox || !credentialBox) {
      throw new Error('Public API panels did not produce layout boxes.');
    }
    expect(credentialBox.y).toBeGreaterThan(
      endpointBox.y + endpointBox.height - 2
    );

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('generates, copies, consults, rotates and revokes a token', async ({
    page,
    request,
  }) => {
    test.skip(
      !tokenMutationEnabled,
      'Set E2E_PUBLIC_API_TOKEN_MUTATION_ENABLED=true only for a disposable account.'
    );

    const ctx = requireRuntime();
    assertDisposableAccount(ctx);
    assertTokenManagementPermission(ctx.loginData);

    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await openIntegrationPage(page, ctx.loginData);

    const card = page.getByTestId('public-api-token-card');
    await expect(card.getByText('Nenhum token gerado')).toBeVisible();

    const generatedToken = await runGenerateOrRotate(page, 'Gerar token');
    expect(generatedToken).toMatch(/^uc_live_[A-Za-z0-9_-]{43}$/);

    await card.getByRole('button', { name: 'Copiar token' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(generatedToken);

    const consultResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' && isTokenEndpoint(response.url())
    );
    await page.reload();
    expect((await consultResponse).ok()).toBe(true);

    const tokenInput = tokenValueInput(page);
    await expect(tokenInput).toBeVisible();
    await card.getByRole('button', { name: 'Revelar token' }).click();
    await expect(tokenInput).toHaveValue(generatedToken);

    const rotatedToken = await runGenerateOrRotate(page, 'Rotacionar token');
    expect(rotatedToken).toMatch(/^uc_live_[A-Za-z0-9_-]{43}$/);
    expect(rotatedToken).not.toBe(generatedToken);

    const revokeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        isTokenEndpoint(response.url())
    );
    await card.getByTestId('public-api-token-revoke').click();
    const revokeDialog = page.getByRole('dialog');
    await expect(
      revokeDialog.getByRole('heading', { name: 'Revogar o token atual?' })
    ).toBeVisible();
    await revokeDialog.getByRole('button', { name: 'Revogar token' }).click();
    expect((await revokeResponse).ok()).toBe(true);

    await expect(card.getByText('Nenhum token gerado')).toBeVisible();
    await expect(card.getByTestId('public-api-token-generate')).toContainText(
      'Gerar token'
    );

    // The destructive flow deliberately ends with no active credential.
    await revokeTokenForCleanup(request, ctx);
  });

  test.afterAll(async ({ request }) => {
    if (!tokenMutationEnabled || !runtime) return;

    assertDisposableAccount(runtime);
    await revokeTokenForCleanup(request, runtime);
  });
});

function readRuntimeConfig(): RuntimeConfig {
  return {
    apiUrl: normalizeBaseUrl(
      process.env.E2E_API_URL ?? 'http://localhost:3002/v1'
    ),
    login: requiredEnv('E2E_LOGIN'),
    password: requiredEnv('E2E_PASSWORD'),
    disposableAccountId: process.env.E2E_DISPOSABLE_ACCOUNT_ID?.trim(),
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

async function openIntegrationPage(
  page: Page,
  loginData: LoginResponse
): Promise<void> {
  await installAuthenticatedStorage(page, loginData);
  await page.goto('/integration');
  await expect(
    page.getByRole('heading', { name: 'Integrações externas' })
  ).toBeVisible({ timeout: 30_000 });
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

async function runGenerateOrRotate(
  page: Page,
  action: 'Gerar token' | 'Rotacionar token'
): Promise<string> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      isTokenGenerateEndpoint(response.url())
  );

  const card = page.getByTestId('public-api-token-card');
  await card.getByTestId('public-api-token-generate').click();

  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', {
      name:
        action === 'Gerar token'
          ? 'Gerar token da API?'
          : 'Rotacionar o token atual?',
    })
  ).toBeVisible();
  await dialog.getByRole('button', { name: action }).click();

  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  const input = tokenValueInput(page);
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/^uc_live_/);
  return input.inputValue();
}

function tokenValueInput(page: Page) {
  return page.getByTestId('public-api-token-value').locator('input');
}

function isTokenEndpoint(rawUrl: string): boolean {
  return new URL(rawUrl).pathname.endsWith('/v1/integration/api-token');
}

function isTokenGenerateEndpoint(rawUrl: string): boolean {
  return new URL(rawUrl).pathname.endsWith(
    '/v1/integration/api-token/generate'
  );
}

function assertDisposableAccount(ctx: RuntimeContext): void {
  const expectedAccountId = ctx.config.disposableAccountId;
  if (!expectedAccountId) {
    throw new Error(
      'E2E_DISPOSABLE_ACCOUNT_ID is required before token mutation.'
    );
  }

  expect(ctx.loginData.user.account_id).toBe(expectedAccountId);
}

function assertTokenManagementPermission(loginData: LoginResponse): void {
  const permissions = new Set(loginData.permissions ?? []);
  const allowed = [
    'full_access',
    'full_access_group',
    'integration_group',
    'integration_generate_key',
  ].some((permission) => permissions.has(permission));

  expect(
    allowed,
    'Disposable user needs integration_generate_key (or an encompassing permission).'
  ).toBe(true);
}

async function revokeTokenForCleanup(
  request: APIRequestContext,
  ctx: RuntimeContext
): Promise<void> {
  await request.delete(`${ctx.config.apiUrl}/integration/api-token`, {
    headers: {
      Authorization: `Bearer ${ctx.loginData.token}`,
      'Accept-Language': 'pt',
    },
  });
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
