import { Static, Type } from '@sinclair/typebox';

export const viewWorkerConfigForKanbanParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewWorkerConfigForKanbanParams = Static<
  typeof viewWorkerConfigForKanbanParamsSchema
>;
