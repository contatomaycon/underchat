import { Static, Type } from '@sinclair/typebox';

export const cityItemSchema = Type.Object({
  id_zipcode_city: Type.String({ format: 'uuid' }),
  city: Type.String(),
});

export const listCitiesResponseSchema = Type.Array(cityItemSchema);

export type CityListResponse = Static<typeof listCitiesResponseSchema>;
