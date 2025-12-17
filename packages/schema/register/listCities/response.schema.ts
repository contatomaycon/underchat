import { Static, Type } from '@sinclair/typebox';

export const registerCityItemSchema = Type.Object({
  id_zipcode_city: Type.String({ format: 'uuid' }),
  city: Type.String(),
  fiscal_code: Type.Union([Type.String(), Type.Null()]),
});

export const listRegisterCitiesResponseSchema = Type.Array(
  registerCityItemSchema
);

export type RegisterCityListResponse = Static<
  typeof listRegisterCitiesResponseSchema
>;
