import { Static, Type } from '@sinclair/typebox';

export const viewUserAddress1ResponseSchema = Type.Object({
  address1: Type.Union([Type.String(), Type.Null()]),
});

export type ViewUserAddress1Response = Static<
  typeof viewUserAddress1ResponseSchema
>;

