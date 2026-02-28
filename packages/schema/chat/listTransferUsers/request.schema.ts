import { Static, Type } from '@sinclair/typebox';

export const listTransferUsersQuerySchema = Type.Object({
  channel_id: Type.Optional(Type.String({ format: 'uuid' })),
  chat_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type ListTransferUsersQuery = Static<
  typeof listTransferUsersQuerySchema
>;
