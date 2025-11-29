import { Static, Type } from '@sinclair/typebox';

export const viewShowMessageOnCallParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewShowMessageOnCallParams = Static<
  typeof viewShowMessageOnCallParamsSchema
>;
