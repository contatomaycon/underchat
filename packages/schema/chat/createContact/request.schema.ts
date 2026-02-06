import { Static, Type } from '@sinclair/typebox';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';

export const createChatContactRequestSchema = Type.Object({
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
  name: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
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
  phone_ddi: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
  phone: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
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
  user_id: Type.Optional(
    Type.Object({
      value: Type.String({ format: 'uuid' }),
    })
  ),
  ignore: Type.Optional(
    Type.Object({
      value: Type.Union([Type.Enum(EContactIgnore), Type.Null()]),
    })
  ),
  channel_ids: Type.Optional(
    Type.Union([
      Type.Array(Type.String({ format: 'uuid' })),
      Type.Object({
        value: Type.Union([
          Type.Array(Type.String({ format: 'uuid' })),
          Type.Null(),
        ]),
      }),
    ])
  ),
});

export type CreateChatContactRequest = Static<
  typeof createChatContactRequestSchema
>;
