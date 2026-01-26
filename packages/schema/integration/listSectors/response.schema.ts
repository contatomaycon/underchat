import { Static, Type } from '@sinclair/typebox';

export const integrationSectorResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type IntegrationSectorResponse = Static<
  typeof integrationSectorResponseSchema
>;

export const listIntegrationSectorsResponseSchema = Type.Array(
  integrationSectorResponseSchema
);

export type ListIntegrationSectorsResponse = Static<
  typeof listIntegrationSectorsResponseSchema
>;
