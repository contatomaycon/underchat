import { Static, Type } from '@sinclair/typebox';

export const updateUraProtocolTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateUraProtocolTextRequestSchema = Type.Object({
  text: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type UpdateUraProtocolTextParams = Static<
  typeof updateUraProtocolTextParamsSchema
>;
export type UpdateUraProtocolTextRequest = Static<
  typeof updateUraProtocolTextRequestSchema
>;
