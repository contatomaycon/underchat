import { Static, Type } from '@sinclair/typebox';

export const viewUserEmailResponseSchema = Type.Object({
  email: Type.Union([Type.String(), Type.Null()]),
});

export type ViewUserEmailResponse = Static<typeof viewUserEmailResponseSchema>;
