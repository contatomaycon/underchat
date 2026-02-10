import { Static, Type } from '@sinclair/typebox';

const labelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

export const exportContactResponseSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nickname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birthday: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contact_document_type_name: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  document: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  labels: Type.Array(labelTemplateSchema),
});

export type ExportContactResponse = Static<typeof exportContactResponseSchema>;
