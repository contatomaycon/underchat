import { Static, Type } from '@sinclair/typebox';

export const viewTransferProtocolSectorAndUserTextParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewTransferProtocolSectorAndUserTextParams = Static<
  typeof viewTransferProtocolSectorAndUserTextParamsSchema
>;
