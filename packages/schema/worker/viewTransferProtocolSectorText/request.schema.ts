import { Static, Type } from '@sinclair/typebox';

export const viewTransferProtocolSectorTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewTransferProtocolSectorTextParams = Static<
  typeof viewTransferProtocolSectorTextParamsSchema
>;
