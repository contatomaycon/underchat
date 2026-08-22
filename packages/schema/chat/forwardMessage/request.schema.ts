import { Static, Type } from '@sinclair/typebox';

export const forwardMessageParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
  message_id: Type.String({ minLength: 1, maxLength: 255 }),
});

export const forwardMessageBodySchema = Type.Object({
  idempotency_key: Type.Optional(
    Type.String({
      format: 'uuid',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      description:
        'Identidade base opcional do encaminhamento. Quando omitida, o servidor gera um UUIDv7 e o devolve na resposta. Para retry seguro, reutilize o idempotency_key devolvido.',
    })
  ),
  retry_of: Type.Optional(
    Type.String({
      format: 'uuid',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    })
  ),
  target_chat_ids: Type.Optional(
    Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 1,
      uniqueItems: true,
      maxItems: 200,
    })
  ),
  target_contact_ids: Type.Optional(
    Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 1,
      uniqueItems: true,
      maxItems: 200,
    })
  ),
  worker_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type ForwardMessageParams = Static<typeof forwardMessageParamsSchema>;
export type ForwardMessageBody = Static<typeof forwardMessageBodySchema>;
