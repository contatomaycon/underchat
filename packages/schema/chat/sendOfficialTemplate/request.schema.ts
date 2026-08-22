import { officialTemplateMessageRequestSchema } from '@core/schema/chat/startChatWithContact/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const sendOfficialTemplateParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export const sendOfficialTemplateRequestSchema =
  officialTemplateMessageRequestSchema;

export type SendOfficialTemplateParams = Static<
  typeof sendOfficialTemplateParamsSchema
>;

export type SendOfficialTemplateRequest = Static<
  typeof sendOfficialTemplateRequestSchema
>;
