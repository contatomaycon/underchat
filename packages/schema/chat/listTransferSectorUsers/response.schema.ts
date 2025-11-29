import { Static, Type } from '@sinclair/typebox';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

export const transferSectorUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Optional(
    Type.Union([
      Type.String({ enum: Object.values(EChatUserStatus) }),
      Type.Null(),
    ])
  ),
});

export type TransferSectorUserResponse = Static<
  typeof transferSectorUserResponseSchema
>;

export const listTransferSectorUsersResponseSchema = Type.Array(
  transferSectorUserResponseSchema
);

export type ListTransferSectorUsersResponse = Static<
  typeof listTransferSectorUsersResponseSchema
>;
