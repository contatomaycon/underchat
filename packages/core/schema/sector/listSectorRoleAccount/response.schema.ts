import { Static, Type } from '@sinclair/typebox';

export const listRoleAccountResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ListRoleAccountResponse = Static<
  typeof listRoleAccountResponseSchema
>;
