import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';

export const updateChatContactParamsRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type UpdateChatContactParamsRequest = Static<
  typeof updateChatContactParamsRequestSchema
>;

export const updateChatContactRequestSchema = Type.Object({
  label_template_ids: Type.Optional(
    Type.Union([
      Type.Array(
        Type.Object({
          value: Type.String({ format: 'uuid' }),
        })
      ),
      Type.Object({
        value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      }),
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
  user_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  ignore: Type.Optional(
    Type.Object({
      value: Type.Union([Type.Enum(EContactIgnore), Type.Null()]),
    })
  ),
});

export type UpdateChatContactRequest = Static<
  typeof updateChatContactRequestSchema
>;
