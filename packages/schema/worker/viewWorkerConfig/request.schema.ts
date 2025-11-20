import { Static, Type } from '@sinclair/typebox';

export const viewWorkerConfigParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewWorkerConfigParams = Static<
  typeof viewWorkerConfigParamsSchema
>;
