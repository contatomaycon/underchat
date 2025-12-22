import { Static, Type } from '@sinclair/typebox';

export const listExclusivePlansRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ListExclusivePlansRequest = Static<
  typeof listExclusivePlansRequestSchema
>;
