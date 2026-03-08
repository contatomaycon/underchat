import { Static, Type } from '@sinclair/typebox';

export const generateAiReplyParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const generateAiReplyBodySchema = Type.Object({
  message_id: Type.String({
    description: 'ID da mensagem alvo para responder',
  }),
  response_type: Type.Union([Type.Literal('text'), Type.Literal('audio')], {
    default: 'text',
    description: 'Tipo de resposta a gerar',
  }),
  instructions: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: 'Orientações adicionais opcionais para o agente de IA',
    })
  ),
});

export type GenerateAiReplyParams = Static<typeof generateAiReplyParamsSchema>;
export type GenerateAiReplyBody = Static<typeof generateAiReplyBodySchema>;
