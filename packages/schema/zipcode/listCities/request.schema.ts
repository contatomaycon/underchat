import { Static, Type } from '@sinclair/typebox';

export const listCitiesRequestSchema = Type.Object({
  id_zipcode_state: Type.String({ format: 'uuid' }),
});

export type ListCitiesRequest = Static<typeof listCitiesRequestSchema>;
