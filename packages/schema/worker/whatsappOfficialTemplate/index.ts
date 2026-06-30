import { Type, Static, TSchema } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

const responseEnvelope = <T extends TSchema>(data: T) =>
  Type.Object({
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Boolean({ const: true }),
    message: Type.String(),
    data,
  });

const errorEnvelope = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
});

const headersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      description: 'Idioma preferencial para a resposta',
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

export const whatsappTemplateCategoryValues = [
  'MARKETING',
  'UTILITY',
  'AUTHENTICATION',
  'FREE_SERVICE',
] as const;

export const whatsappTemplateStatusValues = [
  'APPROVED',
  'ARCHIVED',
  'DELETED',
  'DISABLED',
  'IN_APPEAL',
  'LIMIT_EXCEEDED',
  'PAUSED',
  'PENDING',
  'PENDING_DELETION',
  'REJECTED',
  'DRAFT',
  'SYNC_ERROR',
] as const;

export const whatsappTemplateOriginValues = ['meta', 'underchat'] as const;

export const whatsappTemplateSyncStateValues = [
  'draft',
  'pending_sync',
  'synced',
  'sync_error',
  'inactive',
  'remote_deleted',
] as const;

export const whatsappTemplateParameterFormatValues = [
  'POSITIONAL',
  'NAMED',
] as const;

export const whatsappTemplateParamsSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export const whatsappTemplateIdParamsSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  template_id: Type.String({ format: 'uuid' }),
});

export const whatsappTemplateComponentSchema = Type.Object(
  {
    type: Type.String(),
    format: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    example: Type.Optional(Type.Unknown()),
    buttons: Type.Optional(
      Type.Array(Type.Record(Type.String(), Type.Unknown()))
    ),
  },
  { additionalProperties: true }
);

export const whatsappTemplateResponseSchema = Type.Object({
  whatsapp_message_template_id: Type.String({ format: 'uuid' }),
  worker_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
  waba_id: Type.String(),
  meta_template_id: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  language: Type.String(),
  category: Type.String(),
  sub_category: Type.Union([Type.String(), Type.Null()]),
  parameter_format: Type.Union([Type.String(), Type.Null()]),
  components: Type.Array(whatsappTemplateComponentSchema),
  status: Type.String(),
  quality_score: Type.Union([Type.String(), Type.Null()]),
  rejected_reason: Type.Union([Type.String(), Type.Null()]),
  message_send_ttl_seconds: Type.Union([Type.Number(), Type.Null()]),
  origin: Type.String(),
  sync_state: Type.String(),
  is_active: Type.Boolean(),
  last_synced_at: Type.Union([Type.String(), Type.Null()]),
  last_error: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export const listWhatsappTemplatesQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  category: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  language: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_active: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
});

export const listWhatsappTemplatesResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(whatsappTemplateResponseSchema),
});

export const createWhatsappTemplateRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 512 }),
  language: Type.String({ minLength: 2, maxLength: 50 }),
  category: Type.String({ enum: whatsappTemplateCategoryValues }),
  sub_category: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  parameter_format: Type.Optional(
    Type.Union([
      Type.String({ enum: whatsappTemplateParameterFormatValues }),
      Type.Null(),
    ])
  ),
  components: Type.Array(whatsappTemplateComponentSchema, { minItems: 1 }),
  message_send_ttl_seconds: Type.Optional(
    Type.Union([Type.Number({ minimum: 1 }), Type.Null()])
  ),
});

export const updateWhatsappTemplateRequestSchema = Type.Partial(
  createWhatsappTemplateRequestSchema
);

export const syncWhatsappTemplatesResponseSchema = Type.Object({
  fetched_from_meta: Type.Number(),
  upserted_from_meta: Type.Number(),
  created_on_meta: Type.Number(),
  recreated_on_meta: Type.Number(),
  marked_inactive: Type.Number(),
  errors: Type.Array(Type.String()),
});

export const deleteWhatsappTemplateResponseSchema = Type.Object({
  whatsapp_message_template_id: Type.String({ format: 'uuid' }),
  meta_deleted: Type.Boolean(),
  deactivated: Type.Boolean(),
  last_error: Type.Union([Type.String(), Type.Null()]),
});

const uploadMediaBodySchema = Type.Object({
  file: uploadFileRequestSchema,
});

export const uploadWhatsappTemplateMediaResponseSchema = Type.Object({
  handle: Type.String(),
  filename: Type.String(),
  mimetype: Type.String(),
});

export const listWhatsappTemplatesSchema = {
  description: 'Lista modelos oficiais do WhatsApp',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateParamsSchema,
  querystring: listWhatsappTemplatesQuerySchema,
  response: {
    200: responseEnvelope(listWhatsappTemplatesResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const syncWhatsappTemplatesSchema = {
  description: 'Sincroniza modelos oficiais do WhatsApp com a Meta',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateParamsSchema,
  response: {
    200: responseEnvelope(syncWhatsappTemplatesResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const createWhatsappTemplateSchema = {
  description: 'Cria um modelo oficial do WhatsApp',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateParamsSchema,
  body: createWhatsappTemplateRequestSchema,
  response: {
    200: responseEnvelope(whatsappTemplateResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const viewWhatsappTemplateSchema = {
  description: 'Visualiza um modelo oficial do WhatsApp',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateIdParamsSchema,
  response: {
    200: responseEnvelope(whatsappTemplateResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const updateWhatsappTemplateSchema = {
  description: 'Edita um modelo oficial do WhatsApp',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateIdParamsSchema,
  body: updateWhatsappTemplateRequestSchema,
  response: {
    200: responseEnvelope(whatsappTemplateResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const deleteWhatsappTemplateSchema = {
  description: 'Exclui um modelo oficial do WhatsApp na Meta quando possível',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateIdParamsSchema,
  response: {
    200: responseEnvelope(deleteWhatsappTemplateResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const deactivateWhatsappTemplateSchema = {
  description: 'Desativa localmente um modelo oficial do WhatsApp',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateIdParamsSchema,
  response: {
    200: responseEnvelope(deleteWhatsappTemplateResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const uploadWhatsappTemplateMediaSchema = {
  description:
    'Envia mídia para uso em cabeçalho de modelo oficial do WhatsApp',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  consumes: ['multipart/form-data'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: whatsappTemplateParamsSchema,
  body: uploadMediaBodySchema,
  response: {
    200: responseEnvelope(uploadWhatsappTemplateMediaResponseSchema),
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export type WhatsappTemplateParams = Static<
  typeof whatsappTemplateParamsSchema
>;
export type WhatsappTemplateIdParams = Static<
  typeof whatsappTemplateIdParamsSchema
>;
export type WhatsappTemplateComponent = Static<
  typeof whatsappTemplateComponentSchema
>;
export type ListWhatsappTemplatesQuery = Static<
  typeof listWhatsappTemplatesQuerySchema
>;
export type WhatsappTemplateResponse = Static<
  typeof whatsappTemplateResponseSchema
>;
export type ListWhatsappTemplatesResponse = Static<
  typeof listWhatsappTemplatesResponseSchema
>;
export type CreateWhatsappTemplateRequest = Static<
  typeof createWhatsappTemplateRequestSchema
>;
export type UpdateWhatsappTemplateRequest = Static<
  typeof updateWhatsappTemplateRequestSchema
>;
export type SyncWhatsappTemplatesResponse = Static<
  typeof syncWhatsappTemplatesResponseSchema
>;
export type DeleteWhatsappTemplateResponse = Static<
  typeof deleteWhatsappTemplateResponseSchema
>;
export type UploadWhatsappTemplateMediaResponse = Static<
  typeof uploadWhatsappTemplateMediaResponseSchema
>;
