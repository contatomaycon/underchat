import { Static, Type } from '@sinclair/typebox';

export const chatWorkerResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
});

export type ChatWorkerResponse = Static<typeof chatWorkerResponseSchema>;

export const listChatWorkersResponseSchema = Type.Array(
  chatWorkerResponseSchema
);

export type ListChatWorkersResponse = Static<
  typeof listChatWorkersResponseSchema
>;
