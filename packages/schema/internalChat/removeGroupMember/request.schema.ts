import { Static, Type } from '@sinclair/typebox';

export const removeGroupMemberParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
});
export const removeGroupMemberQuerySchema = Type.Object({});
export const removeGroupMemberBodySchema = Type.Object({});

export type RemoveGroupMemberParams = Static<
  typeof removeGroupMemberParamsSchema
>;
