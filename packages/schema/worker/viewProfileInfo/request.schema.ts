import { Static, Type } from '@sinclair/typebox';

export const viewProfileInfoParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewProfileInfoParams = Static<typeof viewProfileInfoParamsSchema>;
