import { expect, test, type Page } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: process.env.E2E_ENV_FILE ?? '.env' });

const docsEnabled = process.env.E2E_PUBLIC_DOCS_ENABLED === 'true';
const docsUrl = normalizeBaseUrl(
  process.env.E2E_PUBLIC_DOCS_URL ?? 'http://localhost:5174'
);

const openApiFixture = {
  openapi: '3.1.0',
  info: {
    title: 'Underchat Public API E2E',
    version: '1.0.0-e2e',
    description: 'Contrato mínimo usado somente pelo teste do portal.',
  },
  servers: [{ url: 'https://api.e2e.invalid/v1' }],
  tags: [{ name: 'Chat', description: 'Operações públicas de chat.' }],
  paths: {
    '/chat': {
      get: {
        tags: ['Chat'],
        operationId: 'listChatsE2E',
        summary: 'Listar chats E2E',
        description:
          'Operação sentinela para validar a renderização do Scalar.',
        security: [{ authenticateKeyApi: [] }],
        responses: {
          '200': {
            description: 'Chats listados.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      authenticateKeyApi: {
        type: 'apiKey',
        in: 'header',
        name: 'keyapi',
      },
    },
  },
};

test.describe('Underchat public documentation portal', () => {
  test.skip(
    !docsEnabled,
    'Set E2E_PUBLIC_DOCS_ENABLED=true and start public_docs to run portal E2E tests.'
  );

  test('presents the home and navigates to the getting-started guide', async ({
    page,
  }) => {
    await page.goto(docsUrl);

    await expect(
      page.getByRole('heading', { name: /Conversas que fluem/i })
    ).toBeVisible();
    await expect(page.getByText('98', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/chat, etiquetas, setores e usuários/i).first()
    ).toBeVisible();
    await expect(page.getByText('2', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: /Fazer a primeira chamada/i }).click();
    await expect(page).toHaveURL(/\/guias\/primeiros-passos\/?$/);
    await expect(
      page.getByRole('heading', { name: 'Primeiros passos', level: 1 })
    ).toBeVisible();
    await expect(page.getByText(/Envie a credencial no header/i)).toBeVisible();
    await expect(page.getByText(/x-underchat-user-id/i).first()).toBeVisible();
  });

  test('finds guides through local search', async ({ page }) => {
    await page.goto(`${docsUrl}/guias/primeiros-passos`);

    await page
      .getByRole('button', { name: 'Buscar na documentação' })
      .first()
      .click();

    const searchDialog = page.locator('.VPLocalSearchBox');
    await expect(searchDialog).toBeVisible();
    const searchInput = searchDialog.locator('input').first();
    await searchInput.fill('Token da API');
    await expect(searchDialog.getByText(/Token da API/i).first()).toBeVisible();
  });

  test('documents token, authentication, webhook and all four domains', async ({
    page,
  }) => {
    const pages = [
      {
        path: '/guias/token',
        heading: 'Token da API',
        marker: '/v1/integration/api-token/generate',
      },
      {
        path: '/guias/autenticacao',
        heading: 'Autenticação por conta e executor',
        marker: 'x-underchat-user-id',
      },
      {
        path: '/guias/webhook',
        heading: 'Webhook para CRM',
        marker: '/v1/webhook/:keyapi',
      },
      {
        path: '/fluxos/chat',
        heading: 'Chat e atendimento',
        marker: '/v1/chat',
      },
      {
        path: '/fluxos/etiquetas',
        heading: 'Etiquetas',
        marker: '/v1/label',
      },
      {
        path: '/fluxos/setores',
        heading: 'Setores',
        marker: '/v1/sector',
      },
      {
        path: '/fluxos/usuarios',
        heading: 'Usuários',
        marker: '/v1/user/all',
      },
    ];

    for (const entry of pages) {
      await page.goto(`${docsUrl}${entry.path}`);
      await expect(
        page.getByRole('heading', { name: entry.heading, level: 1 })
      ).toBeVisible();
      await expect(
        page.getByText(entry.marker, { exact: false }).first()
      ).toBeVisible();
    }
  });

  test('loads the live OpenAPI contract into Scalar', async ({ page }) => {
    await mockOpenApi(page, () => ({ status: 200, body: openApiFixture }));
    await page.goto(`${docsUrl}/referencia-api`);

    await expect(
      page.getByRole('heading', { name: 'Referência da API', level: 1 })
    ).toBeVisible();
    await expect(page.getByText('Listar chats E2E').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/Underchat Public API E2E/).first()
    ).toBeVisible();
  });

  test('shows the offline state and retries the OpenAPI request', async ({
    page,
  }) => {
    let shouldSucceed = false;
    let requestCount = 0;
    await mockOpenApi(page, () => {
      requestCount += 1;
      return shouldSucceed
        ? { status: 200, body: openApiFixture }
        : { status: 503, body: { message: 'offline for E2E' } };
    });

    await page.goto(`${docsUrl}/referencia-api`);
    const offlineAlert = page.getByRole('alert');
    await expect(offlineAlert).toContainText(
      'Não foi possível abrir a referência.'
    );
    await expect(offlineAlert).toContainText('HTTP 503');

    shouldSucceed = true;
    await offlineAlert
      .getByRole('button', { name: 'Tentar novamente' })
      .click();
    await expect(page.getByText('Listar chats E2E').first()).toBeVisible({
      timeout: 30_000,
    });
    expect(requestCount).toBeGreaterThanOrEqual(2);
  });

  test('keeps the portal readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(docsUrl);

    await expect(
      page.getByRole('heading', { name: /Conversas que fluem/i })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Fazer a primeira chamada/i })
    ).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
});

interface MockOpenApiResult {
  status: number;
  body: unknown;
}

async function mockOpenApi(
  page: Page,
  result: () => MockOpenApiResult
): Promise<void> {
  await page.route('**/docs/openapi.json*', async (route) => {
    const current = result();
    await route.fulfill({
      status: current.status,
      contentType: 'application/json',
      body: JSON.stringify(current.body),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
