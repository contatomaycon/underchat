import { Static, Type } from '@sinclair/typebox';

export const removeChatContactLabelTemplateRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  label_template_id: Type.String({ format: 'uuid' }),
});

export type RemoveChatContactLabelTemplateRequest = Static<
  typeof removeChatContactLabelTemplateRequestSchema
>;
