import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const integrationUserResponseSchema = Type.Object({
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

export type IntegrationUserResponse = Static<
  typeof integrationUserResponseSchema
>;

export const listIntegrationUsersResponseSchema = Type.Array(
  integrationUserResponseSchema
);

export type ListIntegrationUsersResponse = Static<
  typeof listIntegrationUsersResponseSchema
>;
