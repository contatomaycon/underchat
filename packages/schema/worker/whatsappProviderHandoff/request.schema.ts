import { Static, Type } from '@sinclair/typebox';

export const viewWhatsappProviderHandoffParamsSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export const viewWhatsappProviderHandoffEvidenceQuerySchema = Type.Object(
  {
    after_order: Type.Optional(
      Type.String({ pattern: '^[0-9]{1,19}$', maxLength: 19 })
    ),
    operation_id: Type.Optional(Type.String({ format: 'uuid' })),
    debug_trace_id: Type.Optional(
      Type.String({ pattern: '^[a-zA-Z0-9_.:-]{1,128}$', maxLength: 128 })
    ),
  },
  { additionalProperties: false }
);

export const resolveWhatsappProviderHandoffParamsSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  handoff_id: Type.String({ format: 'uuid' }),
});

export const resolveWhatsappProviderHandoffBodySchema = Type.Object(
  {
    action: Type.Union([Type.Literal('return'), Type.Literal('discard')]),
  },
  { additionalProperties: false }
);

export type ViewWhatsappProviderHandoffParams = Static<
  typeof viewWhatsappProviderHandoffParamsSchema
>;
export type ViewWhatsappProviderHandoffEvidenceQuery = Static<
  typeof viewWhatsappProviderHandoffEvidenceQuerySchema
>;
export type ResolveWhatsappProviderHandoffParams = Static<
  typeof resolveWhatsappProviderHandoffParamsSchema
>;
export type ResolveWhatsappProviderHandoffBody = Static<
  typeof resolveWhatsappProviderHandoffBodySchema
>;
