import { Static, Type } from '@sinclair/typebox';

export const apiRequestMethodSchema = Type.Union([
  Type.Literal('GET'),
  Type.Literal('HEAD'),
  Type.Literal('OPTIONS'),
  Type.Literal('POST'),
  Type.Literal('PUT'),
  Type.Literal('PATCH'),
  Type.Literal('DELETE'),
]);

export const apiRequestValueTypeSchema = Type.Union([
  Type.Literal('string'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('object'),
  Type.Literal('array'),
  Type.Literal('null'),
  Type.Literal('binary'),
  Type.Literal('unknown'),
]);

/**
 * `ciphertext` is an internal storage-only field. Controllers must never return
 * it to the editor. A masked editor value is represented by `hasValue: true`
 * and an omitted/empty `value`, keyed by the stable field id.
 */
export const apiRequestProtectedValueSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  value: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
  hasValue: Type.Optional(Type.Boolean()),
  ciphertext: Type.Optional(Type.String()),
});

export const apiRequestKeyValueSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  enabled: Type.Boolean(),
  key: Type.String({ maxLength: 512 }),
  value: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
  sensitive: Type.Boolean(),
  hasValue: Type.Optional(Type.Boolean()),
  ciphertext: Type.Optional(Type.String()),
});

export const apiRequestMultipartPartSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  enabled: Type.Boolean(),
  name: Type.String({ maxLength: 512 }),
  type: Type.Union([Type.Literal('text'), Type.Literal('file')]),
  value: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
  fileName: Type.String({ maxLength: 512 }),
  contentType: Type.String({ maxLength: 256 }),
  sensitive: Type.Boolean(),
  hasValue: Type.Optional(Type.Boolean()),
  ciphertext: Type.Optional(Type.String()),
});

export const apiResponseContractFieldSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 512 }),
  type: apiRequestValueTypeSchema,
  nullable: Type.Optional(Type.Boolean()),
  projectedFromArray: Type.Optional(Type.Boolean()),
});

export const apiRequestTestEvidenceSchema = Type.Object({
  proof: Type.String({ minLength: 1, maxLength: 4 * 1024 * 1024 }),
  fingerprint: Type.String({ minLength: 1, maxLength: 128 }),
  testedAt: Type.String({ minLength: 1, maxLength: 64 }),
  statusCode: Type.Integer({ minimum: 0, maximum: 599 }),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  bodyType: Type.String({ maxLength: 128 }),
});

export const apiRequestConfigSchema = Type.Object({
  version: Type.Literal(1),
  outputKey: Type.String({ pattern: '^api_[1-9][0-9]*$', maxLength: 64 }),
  method: apiRequestMethodSchema,
  url: Type.String({ maxLength: 8192 }),
  queryParams: Type.Array(apiRequestKeyValueSchema, { maxItems: 100 }),
  headers: Type.Array(apiRequestKeyValueSchema, { maxItems: 100 }),
  auth: Type.Object({
    type: Type.Union([
      Type.Literal('none'),
      Type.Literal('bearer'),
      Type.Literal('apiKey'),
      Type.Literal('basic'),
    ]),
    bearer: Type.Object({
      token: apiRequestProtectedValueSchema,
    }),
    apiKey: Type.Object({
      placement: Type.Union([Type.Literal('header'), Type.Literal('query')]),
      name: Type.String({ maxLength: 512 }),
      value: apiRequestProtectedValueSchema,
    }),
    basic: Type.Object({
      username: apiRequestProtectedValueSchema,
      password: apiRequestProtectedValueSchema,
    }),
  }),
  body: Type.Object({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Union([
      Type.Literal('none'),
      Type.Literal('json'),
      Type.Literal('raw'),
      Type.Literal('formUrlEncoded'),
      Type.Literal('multipart'),
    ]),
    json: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
    raw: Type.Optional(Type.String({ maxLength: 1024 * 1024 })),
    contentType: Type.String({ maxLength: 256 }),
    sensitive: Type.Boolean(),
    hasValue: Type.Optional(Type.Boolean()),
    ciphertext: Type.Optional(Type.String()),
    formFields: Type.Array(apiRequestKeyValueSchema, { maxItems: 100 }),
    multipart: Type.Array(apiRequestMultipartPartSchema, { maxItems: 100 }),
  }),
  execution: Type.Object({
    mode: Type.Union([Type.Literal('once'), Type.Literal('forEach')]),
    itemsExpression: Type.String({ maxLength: 8192 }),
    concurrency: Type.Union([
      Type.Literal(1),
      Type.Literal(2),
      Type.Literal(3),
    ]),
    failurePolicy: Type.Union([
      Type.Literal('failFast'),
      Type.Literal('collectErrors'),
    ]),
    timeoutMs: Type.Integer({ minimum: 1000, maximum: 60000 }),
    retry: Type.Object({
      maxAttempts: Type.Union([
        Type.Literal(1),
        Type.Literal(2),
        Type.Literal(3),
      ]),
      initialDelayMs: Type.Integer({ minimum: 100, maximum: 5000 }),
    }),
    idempotencyKey: Type.String({ maxLength: 8192 }),
  }),
  capture: Type.Object({
    mode: Type.Union([Type.Literal('full'), Type.Literal('fields')]),
    paths: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 500 }),
    responseHeaders: Type.Array(Type.String({ maxLength: 256 }), {
      maxItems: 100,
    }),
    contract: Type.Array(apiResponseContractFieldSchema, { maxItems: 500 }),
    availableResponseHeaders: Type.Array(Type.String({ maxLength: 256 }), {
      maxItems: 100,
    }),
  }),
  test: Type.Object({
    state: Type.Union([
      Type.Literal('untested'),
      Type.Literal('tested'),
      Type.Literal('changed'),
    ]),
    evidence: Type.Union([apiRequestTestEvidenceSchema, Type.Null()]),
  }),
});

export const underchatLookupConfigSchema = Type.Object({
  version: Type.Literal(1),
  lookupType: Type.Union([Type.Literal('email'), Type.Literal('document')]),
  lookupExpression: Type.String({ minLength: 1, maxLength: 8192 }),
});

export const chatbotFlowNodeDataSchema = Type.Object({
  outputKey: Type.Optional(
    Type.String({
      pattern: '^(?:data|message|underchat)_[1-9][0-9]*$',
      maxLength: 64,
    })
  ),
  underchatLookup: Type.Optional(underchatLookupConfigSchema),
  restricted: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  messageType: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  attachmentFile: Type.Optional(Type.Any()),
  attachmentSource: Type.Optional(
    Type.Union([Type.Literal('upload'), Type.Literal('variable')])
  ),
  attachmentVariable: Type.Optional(Type.String()),
  attachmentFileName: Type.Optional(Type.String()),
  attachmentUrl: Type.Optional(Type.String()),
  attachmentMimetype: Type.Optional(Type.String()),
  attachmentDuration: Type.Optional(Type.Number()),
  attachmentWidth: Type.Optional(Type.Number()),
  attachmentHeight: Type.Optional(Type.Number()),
  continueType: Type.Optional(Type.String()),
  dataType: Type.Optional(Type.String()),
  firstName: Type.Optional(Type.String()),
  lastName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  cpf: Type.Optional(Type.String()),
  cnpj: Type.Optional(Type.String()),
  redirectType: Type.Optional(Type.String()),
  selectedChannel: Type.Optional(Type.String()),
  selectedUser: Type.Optional(Type.String()),
  selectedSector: Type.Optional(Type.String()),
  selectedSectorUser: Type.Optional(Type.String()),
  tagType: Type.Optional(Type.String()),
  selectedTag: Type.Optional(Type.Array(Type.String())),
  annotation: Type.Optional(Type.String()),
  selectedAiAgent: Type.Optional(Type.String()),
  defaultQuestion: Type.Optional(Type.String()),
  continueMessage: Type.Optional(Type.String()),
  holidayMessage: Type.Optional(Type.String()),
  actionAfterInteractions: Type.Optional(Type.Boolean()),
  interactionsQuantity: Type.Optional(Type.Number()),
  distributionType: Type.Optional(Type.String()),
  distributionHasSector: Type.Optional(Type.Boolean()),
  distributionSelectedSector: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  selectedRandomMessage: Type.Optional(Type.String()),
  official: Type.Optional(Type.Any()),
  officialType: Type.Optional(Type.String()),
  header: Type.Optional(Type.String()),
  footer: Type.Optional(Type.String()),
  buttonText: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  sectionTitle: Type.Optional(Type.String()),
  flowId: Type.Optional(Type.String()),
  flowName: Type.Optional(Type.String()),
  flowToken: Type.Optional(Type.String()),
  flowAction: Type.Optional(Type.String()),
  flowActionPayload: Type.Optional(Type.Any()),
  payload: Type.Optional(Type.Any()),
  latitude: Type.Optional(
    Type.Union([Type.Number(), Type.String(), Type.Null()])
  ),
  longitude: Type.Optional(
    Type.Union([Type.Number(), Type.String(), Type.Null()])
  ),
  latitudeText: Type.Optional(Type.String()),
  longitudeText: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  address: Type.Optional(Type.String()),
  addressCountry: Type.Optional(Type.String()),
  templateName: Type.Optional(Type.String()),
  templateLanguage: Type.Optional(Type.String()),
  templateParameterFormat: Type.Optional(
    Type.Union([Type.Literal('POSITIONAL'), Type.Literal('NAMED')])
  ),
  templateVariables: Type.Optional(Type.Any()),
  templateCategory: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  templateComponents: Type.Optional(Type.Any()),
  templatePreview: Type.Optional(Type.Any()),
  catalogId: Type.Optional(Type.String()),
  productRetailerId: Type.Optional(Type.String()),
  products: Type.Optional(Type.Array(Type.Any())),
  sections: Type.Optional(Type.Array(Type.Any())),
  listSections: Type.Optional(Type.Array(Type.Any())),
  cards: Type.Optional(Type.Array(Type.Any())),
  contacts: Type.Optional(Type.Array(Type.Any())),
  parameters: Type.Optional(Type.Any()),
  action: Type.Optional(Type.Any()),
  emoji: Type.Optional(Type.String()),
  conditionalOperand: Type.Optional(
    Type.Union([Type.Literal('message'), Type.Literal('variable')])
  ),
  conditionalVariable: Type.Optional(Type.String()),
  conditions: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        conditionType: Type.Optional(Type.String()),
        conditionTerm: Type.Optional(Type.String()),
        valueType: Type.Optional(Type.String()),
      })
    )
  ),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        text: Type.String(),
        description: Type.Optional(Type.String()),
        required: Type.Optional(Type.Boolean()),
        start_time: Type.Optional(Type.String()),
        end_time: Type.Optional(Type.String()),
      })
    )
  ),
  apiRequest: Type.Optional(apiRequestConfigSchema),
});

export const chatbotFlowNodeSchema = Type.Object({
  id: Type.String(),
  type: Type.String(),
  position: Type.Object({ x: Type.Number(), y: Type.Number() }),
  data: chatbotFlowNodeDataSchema,
  label: Type.Optional(Type.String()),
  draggable: Type.Optional(Type.Boolean()),
});

export const chatbotFlowEdgeSchema = Type.Object({
  id: Type.String(),
  source: Type.String(),
  target: Type.String(),
  sourceHandle: Type.Optional(Type.String()),
  targetHandle: Type.Optional(Type.String()),
  markerEnd: Type.Optional(Type.Any()),
  style: Type.Optional(Type.Any()),
});

export const chatbotFlowDataSchema = Type.Object({
  chatbot_id: Type.String(),
  nodes: Type.Array(chatbotFlowNodeSchema),
  edges: Type.Array(chatbotFlowEdgeSchema),
});

export type ApiRequestConfig = Static<typeof apiRequestConfigSchema>;
export type ApiRequestProtectedValue = Static<
  typeof apiRequestProtectedValueSchema
>;
export type ApiRequestKeyValue = Static<typeof apiRequestKeyValueSchema>;
export type ApiRequestMultipartPart = Static<
  typeof apiRequestMultipartPartSchema
>;
export type ApiResponseContractField = Static<
  typeof apiResponseContractFieldSchema
>;
export type ApiRequestTestEvidence = Static<
  typeof apiRequestTestEvidenceSchema
>;
export type UnderchatLookupConfig = Static<typeof underchatLookupConfigSchema>;
export type ChatbotFlowNodeData = Static<typeof chatbotFlowNodeDataSchema>;
export type ChatbotFlowNode = Static<typeof chatbotFlowNodeSchema>;
export type ChatbotFlowEdge = Static<typeof chatbotFlowEdgeSchema>;
export type ChatbotFlowData = Static<typeof chatbotFlowDataSchema>;
