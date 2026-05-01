import { Static, Type } from '@sinclair/typebox';

export const updateGroupParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export const updateGroupQuerySchema = Type.Object({});
export const updateGroupBodySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateGroupParams = Static<typeof updateGroupParamsSchema>;
export type UpdateGroupBody = Static<typeof updateGroupBodySchema>;
