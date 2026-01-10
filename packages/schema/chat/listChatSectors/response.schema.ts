import { Static, Type } from '@sinclair/typebox';

export const chatSectorResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ChatSectorResponse = Static<typeof chatSectorResponseSchema>;

export const listChatSectorsResponseSchema = Type.Array(
  chatSectorResponseSchema
);

export type ListChatSectorsResponse = Static<
  typeof listChatSectorsResponseSchema
>;
