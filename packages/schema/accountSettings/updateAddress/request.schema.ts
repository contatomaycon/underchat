import { Static, Type } from '@sinclair/typebox';

export const updateAddressRequestSchema = Type.Object({
  country_id: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  zip_code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address1: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address2: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city_fiscal_code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  state_fiscal_code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  district: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateAddressRequest = Static<typeof updateAddressRequestSchema>;
