import { Static, Type } from '@sinclair/typebox';

export const viewAddress1ResponseSchema = Type.Object({
  address1: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAddress1Response = Static<typeof viewAddress1ResponseSchema>;
