import { Static, Type } from '@sinclair/typebox';

export const listSectorUsersRequestSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListSectorUsersRequest = Static<
  typeof listSectorUsersRequestSchema
>;
