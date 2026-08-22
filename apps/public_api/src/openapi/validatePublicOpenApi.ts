type OpenApiObject = Record<string, unknown>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const AUTHENTICATED_PREFIXES = ['/chat', '/label-template', '/sector', '/user'];
const EXECUTOR_DISCOVERY_PATH = '/user/all';
const EXECUTOR_HEADER_NAME = 'x-underchat-user-id';
const FORBIDDEN_PATHS = ['/user/accounts', '/user/{user_id}/session-login'];

function isObject(value: unknown): value is OpenApiObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`OpenAPI inválido: ${message}`);
}

function validateDocumentedFields(schema: unknown, location: string): void {
  if (Array.isArray(schema)) {
    schema.forEach((item, index) =>
      validateDocumentedFields(item, `${location}[${index}]`)
    );
    return;
  }
  if (!isObject(schema)) return;

  if (isObject(schema.properties)) {
    for (const [name, property] of Object.entries(schema.properties)) {
      assert(isObject(property), `${location}.${name} não é um schema`);
      assert(
        typeof property.description === 'string' &&
          property.description.length > 0,
        `${location}.${name} não possui descrição`
      );
      assert(
        'example' in property || 'examples' in property,
        `${location}.${name} não possui exemplo`
      );
      validateDocumentedFields(property, `${location}.${name}`);
    }
  }

  for (const key of ['items', 'anyOf', 'oneOf', 'allOf', 'not', 'schema']) {
    validateDocumentedFields(schema[key], `${location}.${key}`);
  }
}

function validateContent(content: unknown, location: string): void {
  if (!isObject(content)) return;

  for (const [mediaType, mediaTypeDefinition] of Object.entries(content)) {
    assert(
      isObject(mediaTypeDefinition),
      `${location}.${mediaType} não é uma definição de mídia`
    );
    validateDocumentedFields(
      mediaTypeDefinition.schema,
      `${location}.${mediaType}.schema`
    );
  }
}

function validateOperationContracts(
  operation: OpenApiObject,
  location: string
): void {
  if (Array.isArray(operation.parameters)) {
    operation.parameters.forEach((parameter, index) => {
      assert(isObject(parameter), `${location}.parameters[${index}] inválido`);
      assert(
        typeof parameter.description === 'string' &&
          parameter.description.length > 0,
        `${location}.parameters[${index}] sem descrição`
      );
      validateDocumentedFields(
        parameter.schema,
        `${location}.parameters[${index}].schema`
      );
    });
  }

  if (isObject(operation.requestBody)) {
    assert(
      typeof operation.requestBody.description === 'string' &&
        operation.requestBody.description.length > 0,
      `${location}.requestBody sem descrição`
    );
    validateContent(
      operation.requestBody.content,
      `${location}.requestBody.content`
    );
  }

  assert(isObject(operation.responses), `${location} sem responses`);
  for (const [status, response] of Object.entries(operation.responses)) {
    assert(isObject(response), `${location}.responses.${status} inválida`);
    assert(
      typeof response.description === 'string' &&
        response.description.length > 0,
      `${location}.responses.${status} sem descrição`
    );
    validateContent(
      response.content,
      `${location}.responses.${status}.content`
    );

    if (isObject(response.headers)) {
      for (const [name, header] of Object.entries(response.headers)) {
        assert(
          isObject(header),
          `${location}.responses.${status}.headers.${name} inválido`
        );
        assert(
          typeof header.description === 'string' &&
            header.description.length > 0,
          `${location}.responses.${status}.headers.${name} sem descrição`
        );
        validateDocumentedFields(
          header.schema,
          `${location}.responses.${status}.headers.${name}.schema`
        );
      }
    }
  }
}

export function validatePublicOpenApi(document: unknown): void {
  assert(isObject(document), 'documento ausente');
  assert(document.openapi === '3.1.0', 'a versão deve ser OpenAPI 3.1.0');

  const components = document.components;
  assert(isObject(components), 'components ausente');
  const schemes = components.securitySchemes;
  assert(isObject(schemes), 'securitySchemes ausente');
  assert(
    isObject(schemes.authenticateKeyApi),
    'scheme authenticateKeyApi ausente'
  );
  assert(
    schemes.authenticateKeyApi.name === 'keyapi',
    'header keyapi incorreto'
  );

  const paths = document.paths;
  assert(isObject(paths), 'paths ausente');

  let operationCount = 0;
  let authenticatedOperationCount = 0;
  let executorOperationCount = 0;

  for (const [path, pathItem] of Object.entries(paths)) {
    assert(!FORBIDDEN_PATHS.includes(path), `endpoint administrativo: ${path}`);
    assert(
      AUTHENTICATED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
        path === '/webhook/{keyapi}' ||
        path === '/health/check',
      `endpoint não permitido publicado: ${path}`
    );
    if (!isObject(pathItem)) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation)) continue;
      operationCount += 1;

      assert(
        typeof operation.operationId === 'string' &&
          operation.operationId.length > 0,
        `${method.toUpperCase()} ${path} sem operationId`
      );
      assert(
        typeof operation.description === 'string' &&
          operation.description.length > 0,
        `${method.toUpperCase()} ${path} sem descrição`
      );
      assert(
        Array.isArray(operation.tags) && operation.tags.length > 0,
        `${method.toUpperCase()} ${path} sem tags`
      );
      assert(
        isObject(operation.responses),
        `${method.toUpperCase()} ${path} sem responses`
      );

      if (AUTHENTICATED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        authenticatedOperationCount += 1;
        assert(
          Array.isArray(operation.security) &&
            operation.security.some(
              (item) => isObject(item) && 'authenticateKeyApi' in item
            ),
          `${method.toUpperCase()} ${path} sem segurança keyapi`
        );
        for (const status of ['402', '429', '503']) {
          assert(
            status in operation.responses,
            `${method.toUpperCase()} ${path} sem resposta ${status}`
          );
        }

        if (path !== EXECUTOR_DISCOVERY_PATH) {
          executorOperationCount += 1;
          assert(
            Array.isArray(operation.parameters) &&
              operation.parameters.some(
                (parameter) =>
                  isObject(parameter) &&
                  parameter.in === 'header' &&
                  parameter.name === EXECUTOR_HEADER_NAME &&
                  parameter.required === true
              ),
            `${method.toUpperCase()} ${path} sem header executor obrigatório`
          );
        }
      }

      validateOperationContracts(operation, `${method.toUpperCase()} ${path}`);
    }
  }

  assert(
    operationCount === 100,
    `esperadas 100 operações; recebidas ${operationCount}`
  );
  assert(
    authenticatedOperationCount === 98,
    `esperadas 98 operações autenticadas; recebidas ${authenticatedOperationCount}`
  );
  assert(
    executorOperationCount === 97,
    `esperadas 97 operações com executor; recebidas ${executorOperationCount}`
  );
  if (isObject(components.schemas)) {
    for (const [name, schema] of Object.entries(components.schemas)) {
      validateDocumentedFields(schema, `components.schemas.${name}`);
    }
  }
}
