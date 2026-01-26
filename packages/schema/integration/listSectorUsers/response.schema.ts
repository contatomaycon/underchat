import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const integrationSectorUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatUserStatus) }),
      Type.Null(),
    ])
  ),
});

export type IntegrationSectorUserResponse = Static<
  typeof integrationSectorUserResponseSchema
>;

export const listIntegrationSectorUsersResponseSchema = Type.Array(
  integrationSectorUserResponseSchema
);

export type ListIntegrationSectorUsersResponse = Static<
  typeof listIntegrationSectorUsersResponseSchema
>;
