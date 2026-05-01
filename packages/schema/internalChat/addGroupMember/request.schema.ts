import { Static, Type } from '@sinclair/typebox';

export const addGroupMemberParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export const addGroupMemberQuerySchema = Type.Object({});
export const addGroupMemberBodySchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type AddGroupMemberParams = Static<typeof addGroupMemberParamsSchema>;
export type AddGroupMemberBody = Static<typeof addGroupMemberBodySchema>;
