import { Static, Type } from '@sinclair/typebox';

export const viewAddressResponseSchema = Type.Object({
  country_id: Type.Union([Type.Number(), Type.Null()]),
  zip_code: Type.Union([Type.String(), Type.Null()]),
  address1_partial: Type.Union([Type.String(), Type.Null()]),
  address2_partial: Type.Union([Type.String(), Type.Null()]),
  city: Type.Union([Type.String(), Type.Null()]),
  state: Type.Union([Type.String(), Type.Null()]),
  state_id: Type.Union([Type.String(), Type.Null()]),
  city_id: Type.Union([Type.String(), Type.Null()]),
  district: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAddressResponse = Static<typeof viewAddressResponseSchema>;
