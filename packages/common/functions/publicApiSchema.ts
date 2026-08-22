import { EPlanProduct } from '@core/common/enums/EPlanProduct';

type SchemaDefinition = Record<string, unknown>;

export interface PublicApiSchemaOptions {
  requireExecutor?: boolean;
}

const EXECUTOR_HEADER_NAME = 'x-underchat-user-id';

function errorResponse(description: string, example: string) {
  return {
    type: 'object',
    additionalProperties: true,
    description,
    required: ['status', 'message', 'data'],
    properties: {
      id: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Identificador de rastreio da requisição.',
      },
      status: {
        type: 'boolean',
        const: false,
        description: 'Indica que a operação não foi concluída.',
      },
      message: {
        type: 'string',
        description: 'Mensagem descritiva do erro.',
        examples: [example],
      },
      data: {
        type: 'null',
        description: 'Sem dados para respostas de erro.',
      },
    },
  };
}

function integrationEntitlementErrorResponse(input: {
  description: string;
  reason: 'integration_plan_required' | 'plan_entitlement_unavailable';
  messageExample: string;
  allowNullData?: boolean;
}) {
  const entitlementData = {
    type: 'object',
    additionalProperties: false,
    required: ['reason', 'plan_product_id'],
    properties: {
      reason: { type: 'string', const: input.reason },
      plan_product_id: {
        type: 'string',
        format: 'uuid',
        const: EPlanProduct.integration,
      },
    },
  };

  return {
    type: 'object',
    additionalProperties: true,
    description: input.description,
    required: ['status', 'message', 'data'],
    properties: {
      id: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Identificador de rastreio da requisição.',
      },
      status: { type: 'boolean', const: false },
      message: { type: 'string', examples: [input.messageExample] },
      data: input.allowNullData
        ? { anyOf: [entitlementData, { type: 'null' }] }
        : entitlementData,
    },
  };
}

function badRequestResponse(requireExecutor: boolean) {
  return {
    type: 'object',
    description: requireExecutor
      ? 'Requisição inválida, incluindo header x-underchat-user-id ausente ou fora do formato UUID.'
      : 'Requisição inválida por parâmetros ou campos fora do contrato.',
    properties: {
      id: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Identificador de rastreio da requisição.',
        examples: ['01900000-0000-7000-8000-000000000001'],
      },
      status: {
        type: 'boolean',
        description: 'Indica que a operação não foi concluída.',
        examples: [false],
      },
      statusCode: {
        type: 'number',
        description: 'Código HTTP emitido pela validação de entrada.',
        examples: [400],
      },
      error: {
        type: 'string',
        description: 'Categoria do erro de validação.',
        examples: ['Bad Request'],
      },
      message: {
        type: 'string',
        description: 'Mensagem descritiva do erro.',
        examples: [
          requireExecutor
            ? 'Informe um x-underchat-user-id válido.'
            : 'Revise os dados enviados na requisição.',
        ],
      },
      data: {
        description:
          'Dados adicionais do erro quando a validação de negócio os fornecer.',
        examples: [null],
      },
    },
  };
}

/**
 * Reuses the Manager contract while advertising the public API credential.
 * The source schema is never mutated, so Swagger in Manager continues to
 * announce its session authentication.
 */
export function publicApiSchema<T extends SchemaDefinition>(
  schema: T,
  options: PublicApiSchemaOptions = {}
): T {
  const response = (schema.response ?? {}) as Record<string, unknown>;
  const sourceTags = Array.isArray(schema.tags) ? schema.tags : [];
  const requireExecutor = options.requireExecutor !== false;
  const tags = sourceTags.map((tag) => {
    if (tag === 'Templates de Etiqueta') return 'Etiquetas';
    if (tag === 'Dashboard' || tag === 'Contatos') return 'Chat';
    return tag;
  });
  const sourceHeaders = (schema.headers ?? {}) as SchemaDefinition;
  const sourceHeaderProperties = (sourceHeaders.properties ?? {}) as Record<
    string,
    unknown
  >;
  const sourceRequiredHeaders = Array.isArray(sourceHeaders.required)
    ? sourceHeaders.required.filter(
        (header): header is string => typeof header === 'string'
      )
    : [];
  const headers = requireExecutor
    ? {
        ...sourceHeaders,
        type: 'object',
        properties: {
          ...sourceHeaderProperties,
          [EXECUTOR_HEADER_NAME]: {
            type: 'string',
            format: 'uuid',
            description:
              'ID do usuário ativo da conta que executará esta operação. As permissões, os setores, os canais e a autoria são avaliados nesse contexto.',
            examples: ['01900000-0000-7000-8000-000000000001'],
          },
        },
        required: Array.from(
          new Set([...sourceRequiredHeaders, EXECUTOR_HEADER_NAME])
        ),
      }
    : sourceHeaders;

  return {
    ...schema,
    tags,
    security: [{ authenticateKeyApi: [] }],
    headers,
    response: {
      ...response,
      400: badRequestResponse(requireExecutor),
      402: integrationEntitlementErrorResponse({
        description: 'O plano da conta não inclui o recurso Integração.',
        reason: 'integration_plan_required',
        messageExample: 'Seu plano não inclui Integração.',
      }),
      429: errorResponse(
        'Limite de requisições excedido.',
        'Limite de requisições excedido.'
      ),
      503: integrationEntitlementErrorResponse({
        description:
          'A verificação do plano ou outro serviço obrigatório está temporariamente indisponível.',
        reason: 'plan_entitlement_unavailable',
        messageExample: 'Não foi possível validar os recursos do plano.',
        allowNullData: true,
      }),
    },
  } as T;
}
