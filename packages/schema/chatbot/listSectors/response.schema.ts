import { Static, Type } from '@sinclair/typebox';

export const chatbotSectorResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ChatbotSectorResponse = Static<typeof chatbotSectorResponseSchema>;

export const listChatbotSectorsResponseSchema = Type.Array(
  chatbotSectorResponseSchema
);

export type ListChatbotSectorsResponse = Static<
  typeof listChatbotSectorsResponseSchema
>;
