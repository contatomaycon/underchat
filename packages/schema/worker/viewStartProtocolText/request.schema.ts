import { Static, Type } from '@sinclair/typebox';

export const viewStartProtocolTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewStartProtocolTextParams = Static<
  typeof viewStartProtocolTextParamsSchema
>;
