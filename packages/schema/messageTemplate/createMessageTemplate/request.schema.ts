import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createMessageTemplateRequestSchema = Type.Object({
  message: Type.Object({
    value: Type.String(),
  }),
  command: Type.Object({
    value: Type.String(),
  }),
  attachment_url: Type.Optional(
    Type.Union([uploadFileRequestSchema, Type.Null()])
  ),
  message_status_id: Type.Object({
    value: Type.String({ format: 'uuid' }),
  }),
});

export type CreateMessageTemplateRequest = Static<
  typeof createMessageTemplateRequestSchema
>;
