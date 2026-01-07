import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createUserRequestSchema = Type.Object({
  email: Type.Object({
    value: Type.String(),
  }),
  password: Type.Object({
    value: Type.String(),
  }),
  account_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
  phone_ddi: Type.Optional(
    Type.Object({
      value: Type.String(),
    })
  ),
  phone: Type.Optional(
    Type.Object({
      value: Type.String(),
    })
  ),
  name: Type.Object({
    value: Type.String(),
  }),
  last_name: Type.Object({
    value: Type.String(),
  }),
  birth_date: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  document_type_id: Type.Optional(
    Type.Object({
      value: Type.String({ format: 'uuid' }),
    })
  ),
  document: Type.Optional(
    Type.Object({
      value: Type.String(),
    })
  ),
  country_id: Type.Optional(
    Type.Object({
      value: Type.Number(),
    })
  ),
  zip_code: Type.Optional(
    Type.Object({
      value: Type.String(),
    })
  ),
  address1: Type.Optional(
    Type.Object({
      value: Type.String(),
    })
  ),
  address2: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  city_fiscal_code: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  state_fiscal_code: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  district: Type.Optional(
    Type.Object({
      value: Type.String(),
    })
  ),
  photo: Type.Optional(uploadFileRequestSchema),
  permission_role_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
  sector_ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  user_status_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
});

export type CreateUserRequest = Static<typeof createUserRequestSchema>;
