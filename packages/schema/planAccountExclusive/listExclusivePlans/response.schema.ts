import { Static, Type } from '@sinclair/typebox';

export const listExclusivePlansResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  is_exclusive: Type.Boolean(),
  status: Type.String(),
});

export const listExclusivePlansResponseArraySchema = Type.Array(
  listExclusivePlansResponseSchema
);

export type ListExclusivePlansResponse = Static<
  typeof listExclusivePlansResponseSchema
>;
export type ListExclusivePlansResponseArray = Static<
  typeof listExclusivePlansResponseArraySchema
>;
