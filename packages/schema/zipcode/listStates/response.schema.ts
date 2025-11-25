import { Static, Type } from '@sinclair/typebox';

export const stateItemSchema = Type.Object({
  id_zipcode_state: Type.String({ format: 'uuid' }),
  state: Type.String(),
  abbreviation: Type.Union([Type.String(), Type.Null()]),
});

export const listStatesResponseSchema = Type.Array(stateItemSchema);

export type StateListResponse = Static<typeof listStatesResponseSchema>;
