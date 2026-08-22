import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface PublicApiOperationProbe {
  key: string;
  method: string;
  path: string;
  parameters: Array<{
    in?: string;
    name?: string;
    required?: boolean;
  }>;
  security: Array<Record<string, unknown>>;
  tags: string[];
}

interface PublicApiContractProbe {
  validationError: string | null;
  serverUrl: string;
  operations: PublicApiOperationProbe[];
  healthStatusCode: number;
  missingCredentialStatusCode: number;
  missingExecutorStatusCode: number;
  discoveryWithoutExecutorStatusCode: number;
  rejectedAccountQueryStatusCode: number;
  validUserMultipartStatusCode: number;
  rejectedAccountBodyStatusCode: number;
  rejectedSparseIndexStatusCode: number;
  validPhotoMultipartStatusCode: number;
}

const EXPECTED_CHAT_OPERATIONS = [
  'DELETE /v1/chat/contacts/{contact_id}/labels/{label_template_id}',
  'DELETE /v1/chat/contacts/{contact_id}/photo',
  'DELETE /v1/chat/pinned/{chat_id}',
  'GET /v1/chat',
  'GET /v1/chat/{chat_id}',
  'GET /v1/chat/{chat_id}/attendance-inactivity',
  'GET /v1/chat/{chat_id}/attendants',
  'GET /v1/chat/{chat_id}/official-conversation/context',
  'GET /v1/chat/{chat_id}/search',
  'GET /v1/chat/channels-status',
  'GET /v1/chat/contact-channels',
  'GET /v1/chat/contacts',
  'GET /v1/chat/contacts/{contact_id}',
  'GET /v1/chat/contacts/{contact_id}/channels',
  'GET /v1/chat/contacts/{contact_id}/document',
  'GET /v1/chat/contacts/{contact_id}/email',
  'GET /v1/chat/contacts/{contact_id}/phone',
  'GET /v1/chat/contacts/by-phone',
  'GET /v1/chat/kanban',
  'GET /v1/chat/label-templates',
  'GET /v1/chat/notification-settings',
  'GET /v1/chat/offline-channels',
  'GET /v1/chat/official-opening/context',
  'GET /v1/chat/pinned',
  'GET /v1/chat/quick-message-templates',
  'GET /v1/chat/search',
  'GET /v1/chat/sectors',
  'GET /v1/chat/transfer-options',
  'GET /v1/chat/transfer/sectors',
  'GET /v1/chat/transfer/sectors/{sector_id}/users',
  'GET /v1/chat/transfer/users',
  'GET /v1/chat/unread-summary',
  'GET /v1/chat/users',
  'GET /v1/chat/worker/{worker_id}/config',
  'GET /v1/chat/workers',
  'PATCH /v1/chat/{chat_id}/attendance-inactivity',
  'PATCH /v1/chat/{chat_id}/forward-to-output-chatbot',
  'PATCH /v1/chat/{chat_id}/label',
  'PATCH /v1/chat/{chat_id}/status',
  'PATCH /v1/chat/contacts/{contact_id}',
  'POST /v1/chat/{chat_id}',
  'POST /v1/chat/{chat_id}/ai-generate',
  'POST /v1/chat/{chat_id}/clear-summary',
  'POST /v1/chat/{chat_id}/join',
  'POST /v1/chat/{chat_id}/leave',
  'POST /v1/chat/{chat_id}/message/{message_id}/delete',
  'POST /v1/chat/{chat_id}/message/{message_id}/edit',
  'POST /v1/chat/{chat_id}/message/{message_id}/forward',
  'POST /v1/chat/{chat_id}/message/{message_id}/react',
  'POST /v1/chat/{chat_id}/message/{message_id}/transcribe',
  'POST /v1/chat/{chat_id}/official-template',
  'POST /v1/chat/{chat_id}/transfer',
  'POST /v1/chat/bulk-action',
  'POST /v1/chat/contacts',
  'POST /v1/chat/contacts/{contact_id}/validate',
  'POST /v1/chat/contacts/batch',
  'POST /v1/chat/link-preview',
  'POST /v1/chat/pinned/{chat_id}',
  'POST /v1/chat/start-with-contact',
  'PUT /v1/chat/notification-settings',
  'PUT /v1/chat/user',
].sort();

const EXPECTED_LABEL_OPERATIONS = [
  'DELETE /v1/label-template/{label_template_id}',
  'GET /v1/label-template',
  'GET /v1/label-template/{label_template_id}',
  'GET /v1/label-template/all',
  'PATCH /v1/label-template/{label_template_id}',
  'POST /v1/label-template',
].sort();

const EXPECTED_SECTOR_OPERATIONS = [
  'DELETE /v1/sector/{sector_id}',
  'GET /v1/sector',
  'GET /v1/sector/{sector_id}',
  'GET /v1/sector/{sector_id}/users',
  'PATCH /v1/sector/{sector_id}',
  'POST /v1/sector',
].sort();

const EXPECTED_USER_OPERATIONS = [
  'DELETE /v1/user/{user_id}',
  'DELETE /v1/user/{user_id}/photo',
  'GET /v1/user',
  'GET /v1/user/{user_id}',
  'GET /v1/user/{user_id}/address1',
  'GET /v1/user/{user_id}/address2',
  'GET /v1/user/{user_id}/attendance-hours',
  'GET /v1/user/{user_id}/channels',
  'GET /v1/user/{user_id}/document',
  'GET /v1/user/{user_id}/email',
  'GET /v1/user/{user_id}/phone',
  'GET /v1/user/{user_id}/role',
  'GET /v1/user/{user_id}/sectors',
  'GET /v1/user/all',
  'GET /v1/user/channels',
  'GET /v1/user/me/attendance-hours/status',
  'GET /v1/user/roles',
  'GET /v1/user/sectors',
  'PATCH /v1/user/{user_id}',
  'POST /v1/user',
  'POST /v1/user/{user_id}/block',
  'POST /v1/user/{user_id}/photo',
  'POST /v1/user/{user_id}/role',
  'POST /v1/user/{user_id}/unblock',
  'PUT /v1/user/{user_id}/attendance-hours',
].sort();

function runPublicApiContractProbe(): PublicApiContractProbe {
  const executable = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  const helper = path.resolve(
    process.cwd(),
    'apps/public_api/src/openapi/publicApiContractProbe.ts'
  );
  const output = execFileSync(
    executable,
    ['--tsconfig', 'apps/public_api/tsconfig.tsx.json', helper],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_ENVIRONMENT: 'LOCAL',
        APP_URL_PUBLIC: 'localhost:3001',
        JWT_SECRET: 'public-api-contract-secret',
        JWT_SECRET_EXPIRES_IN: '1h',
      },
      timeout: 60_000,
    }
  );
  const payloadLine = output
    .split('\n')
    .find((line) => line.startsWith('PUBLIC_API_CONTRACT:'));

  if (!payloadLine) {
    throw new Error(`Public API probe did not return a payload: ${output}`);
  }

  return JSON.parse(
    payloadLine.slice('PUBLIC_API_CONTRACT:'.length)
  ) as PublicApiContractProbe;
}

describe('PUBLIC API route contract', () => {
  let probe: PublicApiContractProbe;

  beforeAll(() => {
    probe = runPublicApiContractProbe();
  }, 70_000);

  it('builds a valid OpenAPI document from the real Fastify server', () => {
    expect(probe.validationError).toBeNull();
    expect(new URL(probe.serverUrl).pathname).toBe('/v1');
    expect(probe.healthStatusCode).toBe(200);
  });

  it('exposes exactly 61 chat, 6 label, 6 sector and 25 user operations', () => {
    const keysForPrefix = (prefix: string) =>
      probe.operations
        .filter((operation) => operation.path.startsWith(prefix))
        .map((operation) => operation.key)
        .sort();

    expect(keysForPrefix('/v1/chat')).toEqual(EXPECTED_CHAT_OPERATIONS);
    expect(keysForPrefix('/v1/label-template')).toEqual(
      EXPECTED_LABEL_OPERATIONS
    );
    expect(keysForPrefix('/v1/sector')).toEqual(EXPECTED_SECTOR_OPERATIONS);
    expect(keysForPrefix('/v1/user')).toEqual(EXPECTED_USER_OPERATIONS);
  });

  it('keeps every business operation behind authenticateKeyApi', () => {
    const authenticatedOperations = probe.operations.filter((operation) =>
      ['/v1/chat', '/v1/label-template', '/v1/sector', '/v1/user'].some(
        (prefix) => operation.path.startsWith(prefix)
      )
    );

    expect(authenticatedOperations).toHaveLength(98);
    for (const operation of authenticatedOperations) {
      expect(operation.security).toContainEqual({ authenticateKeyApi: [] });
      expect(operation.tags).toHaveLength(1);
    }
    expect(probe.missingCredentialStatusCode).toBe(401);
  });

  it('requires an explicit executor on every business route except discovery', () => {
    const operationsWithExecutor = probe.operations.filter((operation) =>
      operation.parameters.some(
        (parameter) =>
          parameter.in === 'header' &&
          parameter.name === 'x-underchat-user-id' &&
          parameter.required === true
      )
    );

    expect(operationsWithExecutor).toHaveLength(97);
    expect(
      operationsWithExecutor.some(
        (operation) => operation.key === 'GET /v1/user/all'
      )
    ).toBe(false);
    expect(probe.missingExecutorStatusCode).toBe(400);
    expect(probe.discoveryWithoutExecutorStatusCode).toBe(401);
  });

  it('keeps PUBLIC user inputs account-scoped without breaking multipart', () => {
    expect(probe.rejectedAccountQueryStatusCode).toBe(400);
    expect(probe.rejectedAccountBodyStatusCode).toBe(400);
    expect(probe.rejectedSparseIndexStatusCode).toBe(400);

    // Missing keyapi is evaluated only after the valid multipart contracts.
    expect(probe.validUserMultipartStatusCode).toBe(401);
    expect(probe.validPhotoMultipartStatusCode).toBe(401);
  });

  it('publishes only the allowlist plus webhook and health', () => {
    const operationKeys = probe.operations.map((operation) => operation.key);
    const expectedOperationKeys = [
      ...EXPECTED_CHAT_OPERATIONS,
      ...EXPECTED_LABEL_OPERATIONS,
      ...EXPECTED_SECTOR_OPERATIONS,
      ...EXPECTED_USER_OPERATIONS,
      'GET /v1/health/check',
      'POST /v1/webhook/{keyapi}',
    ].sort();

    expect(operationKeys.sort()).toEqual(expectedOperationKeys);
    expect(operationKeys).toHaveLength(100);
    expect(
      operationKeys.some((operation) =>
        / \/v1\/(account|permission|plan|config|role)(\/|$)/.test(operation)
      )
    ).toBe(false);
    expect(operationKeys).not.toContain('GET /v1/user/accounts');
    expect(operationKeys).not.toContain(
      'POST /v1/user/{user_id}/session-login'
    );
  });

  it('uses separate middleware boundaries for public tokens and webhooks', () => {
    const publicRouteSources = [
      'chat.route.ts',
      'labelTemplate.route.ts',
      'sector.route.ts',
      'user.route.ts',
    ]
      .map((fileName) =>
        fs.readFileSync(
          path.resolve(process.cwd(), 'apps/public_api/src/routes', fileName),
          'utf8'
        )
      )
      .join('\n');
    const webhookRouteSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'apps/public_api/src/routes/webhook.route.ts'
      ),
      'utf8'
    );
    const publicTokenMiddlewareSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'packages/middlewares/publicApiToken.middleware.ts'
      ),
      'utf8'
    );
    const webhookMiddlewareSource = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/middlewares/keyapi.middleware.ts'),
      'utf8'
    );

    expect(publicRouteSources).toContain('authenticatePublicApiToken');
    expect(publicRouteSources).not.toContain('authenticateKeyApi');
    expect(publicRouteSources).not.toContain('authenticateJwt');
    expect(webhookRouteSource).toContain('authenticateKeyApi');
    expect(webhookRouteSource).not.toContain('authenticatePublicApiToken');

    expect(publicTokenMiddlewareSource).toContain('request.headers.keyapi');
    expect(publicTokenMiddlewareSource).not.toContain('request.params');
    expect(webhookMiddlewareSource).not.toContain('request.headers.keyapi');
    expect(webhookMiddlewareSource).toContain(
      "routePath?.startsWith('/webhook/')"
    );
  });

  it('keeps the AI generation route on its specific permission', () => {
    const chatRouteSource = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/public_api/src/routes/chat.route.ts'),
      'utf8'
    );
    const start = chatRouteSource.indexOf(
      "server.post('/chat/:chat_id/ai-generate'"
    );
    const end = chatRouteSource.indexOf('\n  });', start);
    const routeBlock = chatRouteSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(routeBlock).toContain('generateMessageWithAiPermissions');
    expect(routeBlock).not.toContain('chatPermissions)');
  });
});
