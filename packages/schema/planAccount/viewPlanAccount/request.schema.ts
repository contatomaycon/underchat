import { Static, Type } from '@sinclair/typebox';

export const viewPlanAccountParamsRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ViewPlanAccountParamsRequest = Static<
  typeof viewPlanAccountParamsRequestSchema
>;
