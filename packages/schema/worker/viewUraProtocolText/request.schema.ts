import { Static, Type } from '@sinclair/typebox';

export const viewUraProtocolTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewUraProtocolTextParams = Static<
  typeof viewUraProtocolTextParamsSchema
>;
