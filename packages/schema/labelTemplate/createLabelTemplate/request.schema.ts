import { Static, Type } from '@sinclair/typebox';

const labelStatusSchema = Type.Object({
  label_status_id: Type.String({ format: 'uuid' }),
});

export const createLabelTemplateRequestSchema = Type.Object({
  label: Type.String(),
  color: Type.String(),
  label_status: labelStatusSchema,
});

export type CreateLabelTemplateRequest = Static<
  typeof createLabelTemplateRequestSchema
>;
