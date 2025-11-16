import { Static, Type } from '@sinclair/typebox';

export const viewContactEmailResponseSchema = Type.Object({
  email: Type.Union([Type.String(), Type.Null()]),
});

export type ViewContactEmailResponse = Static<
  typeof viewContactEmailResponseSchema
>;
