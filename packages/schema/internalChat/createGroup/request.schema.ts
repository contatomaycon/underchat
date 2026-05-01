import { Static, Type } from '@sinclair/typebox';

export const createGroupParamsSchema = Type.Object({});
export const createGroupQuerySchema = Type.Object({});
export const createGroupBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  member_user_ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1 }),
});

export type CreateGroupBody = Static<typeof createGroupBodySchema>;
