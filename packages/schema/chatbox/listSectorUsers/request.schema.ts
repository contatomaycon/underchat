import { Static, Type } from '@sinclair/typebox';

export const listChatboxSectorUsersParamsSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListChatboxSectorUsersParams = Static<
  typeof listChatboxSectorUsersParamsSchema
>;
