import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const transferUserResponseSchema = Type.Object({
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

export type TransferUserResponse = Static<typeof transferUserResponseSchema>;

export const listTransferUsersResponseSchema = Type.Array(
  transferUserResponseSchema
);

export type ListTransferUsersResponse = Static<
  typeof listTransferUsersResponseSchema
>;
