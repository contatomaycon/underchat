import { Static, Type } from '@sinclair/typebox';

export const whatsappOfficialHealthParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type WhatsappOfficialHealthParams = Static<
  typeof whatsappOfficialHealthParamsSchema
>;
