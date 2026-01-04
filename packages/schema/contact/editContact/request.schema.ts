import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const editContactParamsRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type EditContactParamsRequest = Static<
  typeof editContactParamsRequestSchema
>;

export const updateContactRequestSchema = Type.Object({
  label_template_id: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  name: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  last_name: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  email: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  phone_ddi: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  phone: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  nickname: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  birthday: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  notes: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  contact_document_type_id: Type.Optional(
    Type.Union([
      Type.String({ format: 'uuid' }),
      Type.String(),
      Type.Object({
        value: Type.Union([Type.String({ format: 'uuid' }), Type.String()]),
      }),
      Type.Null(),
    ])
  ),
  document: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  photo: Type.Optional(uploadFileRequestSchema),
  image_url: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({ value: Type.String() }),
      Type.Null(),
    ])
  ),
  chat_id: Type.Optional(
    Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Object({
        value: Type.String({ format: 'uuid' }),
      }),
      Type.Null(),
    ])
  ),
});

export type UpdateContactRequest = Static<typeof updateContactRequestSchema>;
