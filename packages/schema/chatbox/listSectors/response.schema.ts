import { Static, Type } from '@sinclair/typebox';

export const chatboxSectorResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ChatboxSectorResponse = Static<typeof chatboxSectorResponseSchema>;

export const listChatboxSectorsResponseSchema = Type.Array(
  chatboxSectorResponseSchema
);

export type ListChatboxSectorsResponse = Static<
  typeof listChatboxSectorsResponseSchema
>;
