import { Static, Type } from '@sinclair/typebox';

export const viewTransferProtocolTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewTransferProtocolTextParams = Static<
  typeof viewTransferProtocolTextParamsSchema
>;
