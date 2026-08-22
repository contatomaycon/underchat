import { Static, Type } from '@sinclair/typebox';

export const editMessageParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
  message_id: Type.String({ minLength: 1, maxLength: 255 }),
});

export const editMessageBodySchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 65536 }),
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

export type EditMessageParams = Static<typeof editMessageParamsSchema>;
export type EditMessageBody = Static<typeof editMessageBodySchema>;
