import { Static, Type } from '@sinclair/typebox';

export const listStatesRequestSchema = Type.Object({
  country_id: Type.Optional(Type.Number()),
});

export type ListStatesRequest = Static<typeof listStatesRequestSchema>;
