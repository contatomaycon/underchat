import { Static, Type } from '@sinclair/typebox';

export const viewUserAddress2ResponseSchema = Type.Object({
  address2: Type.Union([Type.String(), Type.Null()]),
});

export type ViewUserAddress2Response = Static<
  typeof viewUserAddress2ResponseSchema
>;
