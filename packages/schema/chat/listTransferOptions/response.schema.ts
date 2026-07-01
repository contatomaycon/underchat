import { Static, Type } from '@sinclair/typebox';

const workerStatusSchema = Type.Object({
  id: Type.String(),
});

const sectorStatusSchema = Type.Object({
  id: Type.String(),
});

const transferWorkerSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
  type_id: Type.Optional(Type.String()),
  is_official: Type.Optional(Type.Boolean()),
  status: Type.Union([workerStatusSchema, Type.Null()]),
});

const transferSectorSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  color: Type.String(),
  sector_status: Type.Union([sectorStatusSchema, Type.Null()]),
});

const transferChatbotSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listTransferOptionsResponseSchema = Type.Object({
  sectors: Type.Array(transferSectorSchema),
  workers: Type.Array(transferWorkerSchema),
  chatbots: Type.Array(transferChatbotSchema),
});

export type TransferWorker = Static<typeof transferWorkerSchema>;
export type TransferSector = Static<typeof transferSectorSchema>;
export type TransferChatbot = Static<typeof transferChatbotSchema>;
export type ListTransferOptionsResponse = Static<
  typeof listTransferOptionsResponseSchema
>;
