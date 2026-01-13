import { Static, Type } from '@sinclair/typebox';

export const updateChatLabelParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export const updateChatLabelBodySchema = Type.Object({
  label_template_ids: Type.Optional(
    Type.Union([
      Type.Array(
        Type.Object({
          value: Type.String({ format: 'uuid' }),
        })
      ),
      Type.Object({
        value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      }),
    ])
  ),
});

export type UpdateChatLabelParams = Static<typeof updateChatLabelParamsSchema>;
export type UpdateChatLabelRequest = Static<typeof updateChatLabelBodySchema>;
