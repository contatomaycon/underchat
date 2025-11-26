import { Static, Type } from '@sinclair/typebox';

export const transferUserResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export type TransferUserResponse = Static<typeof transferUserResponseSchema>;

export const listTransferUsersResponseSchema = Type.Array(
  transferUserResponseSchema
);

export type ListTransferUsersResponse = Static<
  typeof listTransferUsersResponseSchema
>;
