import { Static, Type } from '@sinclair/typebox';

export const listTransferSectorUsersParamsSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListTransferSectorUsersParams = Static<
  typeof listTransferSectorUsersParamsSchema
>;
