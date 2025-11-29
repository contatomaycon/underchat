import { Static, Type } from '@sinclair/typebox';

export const updateShowMessageOnCallParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateShowMessageOnCallRequestSchema = Type.Object({
  text: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type UpdateShowMessageOnCallParams = Static<
  typeof updateShowMessageOnCallParamsSchema
>;
export type UpdateShowMessageOnCallRequest = Static<
  typeof updateShowMessageOnCallRequestSchema
>;
