import { Static, Type } from '@sinclair/typebox';

export const listPlanAllResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ListPlanAllResponse = Static<typeof listPlanAllResponseSchema>;
