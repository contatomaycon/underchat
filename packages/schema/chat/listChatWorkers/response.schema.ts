import { Static, Type } from '@sinclair/typebox';

export const chatWorkerResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
  type_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_official: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
});

export type ChatWorkerResponse = Static<typeof chatWorkerResponseSchema>;

export const listChatWorkersResponseSchema = Type.Array(
  chatWorkerResponseSchema
);

export type ListChatWorkersResponse = Static<
  typeof listChatWorkersResponseSchema
>;
