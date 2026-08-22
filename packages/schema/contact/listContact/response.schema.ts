import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { contactValidationStatusSchema } from '../contactValidationStatus.schema';

const labelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

const accountSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

const responsibleAttendantSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listContactResponseSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  account: accountSchema,
  label_templates: Type.Array(labelTemplateSchema),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nickname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birthday: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_valided: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  validation_status: Type.Optional(contactValidationStatusSchema),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  responsible_attendant: Type.Optional(
    Type.Union([responsibleAttendantSchema, Type.Null()])
  ),
});

export const listContactFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listContactResponseSchema),
});

export type ListContactResponse = Static<typeof listContactResponseSchema>;
export type ListContactFinalResponse = Static<
  typeof listContactFinalResponseSchema
>;
