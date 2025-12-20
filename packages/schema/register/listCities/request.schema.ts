import { Static, Type } from '@sinclair/typebox';

export const listRegisterCitiesRequestSchema = Type.Object({
  id_zipcode_state: Type.String({ format: 'uuid' }),
});

export type ListRegisterCitiesRequest = Static<
  typeof listRegisterCitiesRequestSchema
>;
