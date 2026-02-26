import { Static, Type } from '@sinclair/typebox';

export const listChannelServersItemResponseSchema = Type.Object({
  server_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listChannelServersResponseSchema = Type.Object({
  results: Type.Array(listChannelServersItemResponseSchema),
});

export type ListChannelServersItemResponse = Static<
  typeof listChannelServersItemResponseSchema
>;
export type ListChannelServersResponse = Static<
  typeof listChannelServersResponseSchema
>;
