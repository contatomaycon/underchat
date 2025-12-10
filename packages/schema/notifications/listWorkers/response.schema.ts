import { Static, Type } from '@sinclair/typebox';

export const listWorkersResponseSchema = Type.Array(
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    number: Type.Union([Type.String(), Type.Null()]),
  })
);

export type ListWorkersResponse = Static<typeof listWorkersResponseSchema>;
