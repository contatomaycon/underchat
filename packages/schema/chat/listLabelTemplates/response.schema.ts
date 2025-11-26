import { Static, Type } from '@sinclair/typebox';

export const listChatLabelTemplatesResponseSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
});

export type ListChatLabelTemplatesResponse = Static<
  typeof listChatLabelTemplatesResponseSchema
>;
