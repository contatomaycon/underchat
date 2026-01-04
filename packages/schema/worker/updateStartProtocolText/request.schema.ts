import { Static, Type } from '@sinclair/typebox';

export const updateStartProtocolTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateStartProtocolTextRequestSchema = Type.Object({
  text: Type.Optional(Type.String({ maxLength: 2000 })),
  enabled: Type.Boolean(),
});

export type UpdateStartProtocolTextParams = Static<
  typeof updateStartProtocolTextParamsSchema
>;
export type UpdateStartProtocolTextRequest = Static<
  typeof updateStartProtocolTextRequestSchema
>;
