import { Static, Type } from '@sinclair/typebox';

export const groupMembersParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export const groupMembersQuerySchema = Type.Object({});
export const groupMembersBodySchema = Type.Object({});

export type GroupMembersParams = Static<typeof groupMembersParamsSchema>;
