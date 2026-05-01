import { Static, Type } from '@sinclair/typebox';

export const listGroupMembersParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export const listGroupMembersQuerySchema = Type.Object({});
export const listGroupMembersBodySchema = Type.Object({});

export type ListGroupMembersParams = Static<
  typeof listGroupMembersParamsSchema
>;
