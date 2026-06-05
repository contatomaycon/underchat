import { Static, Type } from '@sinclair/typebox';

export const listWarmChannelServersItemResponseSchema = Type.Object({
  server_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listWarmChannelServersResponseSchema = Type.Object({
  results: Type.Array(listWarmChannelServersItemResponseSchema),
});

export type ListWarmChannelServersItemResponse = Static<
  typeof listWarmChannelServersItemResponseSchema
>;
export type ListWarmChannelServersResponse = Static<
  typeof listWarmChannelServersResponseSchema
>;
