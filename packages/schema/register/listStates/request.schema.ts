import { Static, Type } from '@sinclair/typebox';

export const listRegisterStatesRequestSchema = Type.Object({
  country_id: Type.Optional(Type.Number()),
});

export type ListRegisterStatesRequest = Static<
  typeof listRegisterStatesRequestSchema
>;
