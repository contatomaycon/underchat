import { Static, Type } from '@sinclair/typebox';

export const listSectorRoleAccountSectorResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ListSectorRoleAccountSectorResponse = Static<
  typeof listSectorRoleAccountSectorResponseSchema
>;
