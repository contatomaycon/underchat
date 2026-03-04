import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createMessageTemplateRequestSchema = Type.Object({
  message: Type.Object({
    value: Type.String(),
  }),
  command: Type.Object({
    value: Type.String(),
  }),
  channel_ids: Type.Optional(
    Type.Union([
      Type.Array(Type.String({ format: 'uuid' })),
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.Union([
          Type.Array(Type.String({ format: 'uuid' })),
          Type.String(),
          Type.Null(),
        ]),
      }),
    ])
  ),
  attachment_url: Type.Optional(
    Type.Union([uploadFileRequestSchema, Type.Null()])
  ),
  message_status_id: Type.Object({
    value: Type.String({ format: 'uuid' }),
  }),
  type: Type.Object({
    value: Type.String(),
  }),
  auto_send: Type.Optional(
    Type.Object({
      value: Type.Boolean(),
    })
  ),
});

export type CreateMessageTemplateRequest = Static<
  typeof createMessageTemplateRequestSchema
>;
