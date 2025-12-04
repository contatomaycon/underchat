import { Static, Type } from '@sinclair/typebox';

export const updateAdditionalInfoRequestSchema = Type.Object({
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birth_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  document_type_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  document: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateAdditionalInfoRequest = Static<
  typeof updateAdditionalInfoRequestSchema
>;
