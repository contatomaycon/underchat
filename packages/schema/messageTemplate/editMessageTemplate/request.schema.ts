import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const editMessageTemplateParamsRequestSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
});

export type EditMessageTemplateParamsRequest = Static<
  typeof editMessageTemplateParamsRequestSchema
>;

export const updateMessageTemplateRequestSchema = Type.Object({
  channel_id: Type.Optional(
    Type.Object({
      value: Type.Optional(
        Type.Union([
          Type.String({ format: 'uuid' }),
          Type.Null(),
          Type.Literal(''),
          Type.Literal('null'),
        ])
      ),
    })
  ),
  message: Type.Object({
    value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  command: Type.Object({
    value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  attachment_url: Type.Optional(
    Type.Union([uploadFileRequestSchema, Type.Null()])
  ),
  message_status_id: Type.Object({
    value: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
    ),
  }),
  type: Type.Object({
    value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  auto_send: Type.Optional(
    Type.Object({
      value: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    })
  ),
});

export type UpdateMessageTemplateRequest = Static<
  typeof updateMessageTemplateRequestSchema
>;
