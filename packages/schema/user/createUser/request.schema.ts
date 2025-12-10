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
  phone_ddi: Type.Object({
    value: Type.String(),
  }),
  phone: Type.Object({
    value: Type.String(),
  }),
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
  document_type_id: Type.Object({
    value: Type.String({ format: 'uuid' }),
  }),
  document: Type.Object({
    value: Type.String(),
  }),
  country_id: Type.Object({
    value: Type.Number(),
  }),
  zip_code: Type.Object({
    value: Type.String(),
  }),
  address1: Type.Object({
    value: Type.String(),
  }),
  address2: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String(), Type.Null()]),
    })
  ),
  city_fiscal_code: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  state_fiscal_code: Type.Object({
    value: Type.Union([Type.String(), Type.Null()]),
  }),
  district: Type.Object({
    value: Type.String(),
  }),
  photo: Type.Optional(uploadFileRequestSchema),
  permission_role_id: Type.Optional(
    Type.Object({
      value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    })
  ),
});

export type CreateUserRequest = Static<typeof createUserRequestSchema>;
