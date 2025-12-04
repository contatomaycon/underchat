import { Static, Type } from '@sinclair/typebox';

export const viewAddress2ResponseSchema = Type.Object({
  address2: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAddress2Response = Static<typeof viewAddress2ResponseSchema>;
