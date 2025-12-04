import { Static, Type } from '@sinclair/typebox';

export const viewAdditionalInfoResponseSchema = Type.Object({
  phone_ddi: Type.Union([Type.String(), Type.Null()]),
  phone_partial: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  last_name: Type.Union([Type.String(), Type.Null()]),
  birth_date: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
  document_type_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  document_partial: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAdditionalInfoResponse = Static<
  typeof viewAdditionalInfoResponseSchema
>;
