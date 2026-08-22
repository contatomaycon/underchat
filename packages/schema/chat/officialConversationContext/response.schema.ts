import { officialWindowSchema } from '@core/schema/chat/officialWindow.schema';
import { officialTemplateSchema } from '@core/schema/chat/officialOpeningContext/response.schema';
import { Static, Type } from '@sinclair/typebox';

export const officialConversationContextResponseSchema = Type.Object({
  chat_id: Type.String(),
  worker_id: Type.String(),
  contact_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.String(),
  is_official: Type.Boolean(),
  official_window: officialWindowSchema,
  templates: Type.Array(officialTemplateSchema),
});

export type OfficialConversationContextResponse = Static<
  typeof officialConversationContextResponseSchema
>;
