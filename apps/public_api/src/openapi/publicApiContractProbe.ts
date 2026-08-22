import 'reflect-metadata';

process.env.APP_ENVIRONMENT ??= 'LOCAL';
process.env.APP_URL_PUBLIC ??= 'localhost:3001';
process.env.JWT_SECRET ??= 'public-api-contract-secret';
process.env.JWT_SECRET_EXPIRES_IN ??= '1h';

interface OpenApiOperation {
  parameters?: Array<{
    in?: string;
    name?: string;
    required?: boolean;
  }>;
  security?: Array<Record<string, unknown>>;
  tags?: string[];
}

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  servers?: Array<{ url?: string }>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const EXECUTOR_USER_ID = '00000000-0000-4000-8000-000000000001';

function multipartPayload(
  boundary: string,
  fields: Array<[name: string, value: string]>
): Buffer {
  return Buffer.from(
    `${fields
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
      .join('')}--${boundary}--\r\n`
  );
}

function multipartFilePayload(boundary: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="avatar.jpg"\r\nContent-Type: image/jpeg\r\n\r\nimage-bytes\r\n--${boundary}--\r\n`
  );
}

const { enrichPublicOpenApi } =
  await import('@core/common/functions/enrichPublicOpenApi');
const { buildPublicServer } = await import('@/index');
const { validatePublicOpenApi } =
  await import('@/openapi/validatePublicOpenApi');

const server = buildPublicServer({ infrastructure: false, logger: false });

try {
  await server.ready();

  const document = enrichPublicOpenApi(
    server.swagger() as OpenApiDocument
  ) as OpenApiDocument;
  let validationError: string | null = null;

  try {
    validatePublicOpenApi(document);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  const serverUrl = document.servers?.[0]?.url ?? '';
  const serverBasePath = serverUrl
    ? new URL(serverUrl).pathname.replace(/\/$/, '')
    : '';
  const operations = Object.entries(document.paths ?? {}).flatMap(
    ([openApiPath, pathItem]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = pathItem[method];
        if (!operation) return [];
        const path = `${serverBasePath}${openApiPath}`;

        return [
          {
            key: `${method.toUpperCase()} ${path}`,
            path,
            method,
            parameters: operation.parameters ?? [],
            security: operation.security ?? [],
            tags: operation.tags ?? [],
          },
        ];
      })
  );

  const healthResponse = await server.inject({
    method: 'GET',
    url: '/v1/health/check',
  });
  const missingCredentialResponse = await server.inject({
    method: 'GET',
    url: '/v1/chat/notification-settings',
    headers: {
      'x-underchat-user-id': EXECUTOR_USER_ID,
    },
  });
  const missingExecutorResponse = await server.inject({
    method: 'GET',
    url: '/v1/chat/notification-settings',
    headers: { keyapi: 'uc_live_invalid_but_well_formed_for_validation' },
  });
  const discoveryWithoutExecutorResponse = await server.inject({
    method: 'GET',
    url: '/v1/user/all',
  });
  const rejectedAccountQueryResponse = await server.inject({
    method: 'GET',
    url: `/v1/user?account_id=${EXECUTOR_USER_ID}`,
    headers: { 'x-underchat-user-id': EXECUTOR_USER_ID },
  });

  const userMultipartBoundary = '----underchat-public-user';
  const requiredUserFields: Array<[string, string]> = [
    ['email', 'integracao@exemplo.com'],
    ['password', 'senha-segura'],
    ['name', 'Integração'],
    ['last_name', 'Underchat'],
    ['sector_ids[0]', EXECUTOR_USER_ID],
  ];
  const validUserMultipartResponse = await server.inject({
    method: 'POST',
    url: '/v1/user',
    headers: {
      'content-type': `multipart/form-data; boundary=${userMultipartBoundary}`,
      'x-underchat-user-id': EXECUTOR_USER_ID,
    },
    payload: multipartPayload(userMultipartBoundary, requiredUserFields),
  });
  const rejectedAccountBodyResponse = await server.inject({
    method: 'POST',
    url: '/v1/user',
    headers: {
      'content-type': `multipart/form-data; boundary=${userMultipartBoundary}`,
      'x-underchat-user-id': EXECUTOR_USER_ID,
    },
    payload: multipartPayload(userMultipartBoundary, [
      ...requiredUserFields,
      ['account_id', EXECUTOR_USER_ID],
    ]),
  });
  const rejectedSparseIndexResponse = await server.inject({
    method: 'POST',
    url: '/v1/user',
    headers: {
      'content-type': `multipart/form-data; boundary=${userMultipartBoundary}`,
      'x-underchat-user-id': EXECUTOR_USER_ID,
    },
    payload: multipartPayload(userMultipartBoundary, [
      ...requiredUserFields.slice(0, -1),
      ['sector_ids[4294967294]', EXECUTOR_USER_ID],
    ]),
  });

  const photoBoundary = '----underchat-public-photo';
  const validPhotoMultipartResponse = await server.inject({
    method: 'POST',
    url: `/v1/user/${EXECUTOR_USER_ID}/photo`,
    headers: {
      'content-type': `multipart/form-data; boundary=${photoBoundary}`,
      'x-underchat-user-id': EXECUTOR_USER_ID,
    },
    payload: multipartFilePayload(photoBoundary),
  });

  process.stdout.write(
    `PUBLIC_API_CONTRACT:${JSON.stringify({
      validationError,
      serverUrl,
      operations,
      healthStatusCode: healthResponse.statusCode,
      missingCredentialStatusCode: missingCredentialResponse.statusCode,
      missingExecutorStatusCode: missingExecutorResponse.statusCode,
      discoveryWithoutExecutorStatusCode:
        discoveryWithoutExecutorResponse.statusCode,
      rejectedAccountQueryStatusCode: rejectedAccountQueryResponse.statusCode,
      validUserMultipartStatusCode: validUserMultipartResponse.statusCode,
      rejectedAccountBodyStatusCode: rejectedAccountBodyResponse.statusCode,
      rejectedSparseIndexStatusCode: rejectedSparseIndexResponse.statusCode,
      validPhotoMultipartStatusCode: validPhotoMultipartResponse.statusCode,
    })}\n`
  );
} finally {
  await server.close();
}
