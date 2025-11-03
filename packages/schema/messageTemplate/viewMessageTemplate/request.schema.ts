import { Static, Type } from '@sinclair/typebox';

export const viewMessageTemplateRequestSchema = Type.Object({
  message_template_id: Type.String({ format: 'uuid' }),
});

export type ViewMessageTemplateRequest = Static<
  typeof viewMessageTemplateRequestSchema
>;
