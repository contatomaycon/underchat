import { Static, Type } from '@sinclair/typebox';

export const deleteMessageParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
  message_id: Type.String({ minLength: 1, maxLength: 255 }),
});

export const deleteMessageBodySchema = Type.Object({
  operation_id: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 256,
      description:
        'Identidade opcional da operacao. Quando omitida, o servidor gera um UUIDv7 e o devolve na resposta. Para retry seguro, reutilize o operation_id devolvido.',
    })
  ),
  retry_of: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
});

// A DELETE request historically had no body. Fastify validates an absent body
// against a root object as an error, so the HTTP schema deliberately has no
// root `type` while retaining property validation whenever a body is sent.
export const deleteMessageOptionalHttpBodySchema = Type.Any({
  description:
    'Corpo inteiro opcional para compatibilidade. operation_id e retry_of, quando enviados, seguem o contrato documentado em DeleteMessageBody.',
  examples: [
    {},
    {
      operation_id: '019a0000-0000-7000-8000-000000000001',
      retry_of: '019a0000-0000-7000-8000-000000000002',
    },
  ],
});

export type DeleteMessageParams = Static<typeof deleteMessageParamsSchema>;
export type DeleteMessageBody = Static<typeof deleteMessageBodySchema>;
