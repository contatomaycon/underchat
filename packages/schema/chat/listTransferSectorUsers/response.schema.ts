import { Static, Type } from '@sinclair/typebox';

export const transferSectorUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
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
