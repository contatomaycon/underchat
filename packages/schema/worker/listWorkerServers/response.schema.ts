import { Static, Type } from '@sinclair/typebox';

export const listWorkerServersItemResponseSchema = Type.Object({
  server_id: Type.String(),
  name: Type.String(),
});

export const listWorkerServersResponseSchema = Type.Object({
  results: Type.Array(listWorkerServersItemResponseSchema),
});

export type ListWorkerServersItemResponse = Static<
  typeof listWorkerServersItemResponseSchema
>;
export type ListWorkerServersResponse = Static<
  typeof listWorkerServersResponseSchema
>;
