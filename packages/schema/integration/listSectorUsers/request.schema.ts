import { Static, Type } from '@sinclair/typebox';

export const listIntegrationSectorUsersParamsSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListIntegrationSectorUsersParams = Static<
  typeof listIntegrationSectorUsersParamsSchema
>;
