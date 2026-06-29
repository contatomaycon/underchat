import { Static, Type } from '@sinclair/typebox';

export const connectWhatsappOfficialParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ConnectWhatsappOfficialParams = Static<
  typeof connectWhatsappOfficialParamsSchema
>;
