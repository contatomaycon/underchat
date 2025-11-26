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
  status: Type.Union([workerStatusSchema, Type.Null()]),
});

const transferSectorSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  color: Type.String(),
  sector_status: Type.Union([sectorStatusSchema, Type.Null()]),
});

export const listTransferOptionsResponseSchema = Type.Object({
  sectors: Type.Array(transferSectorSchema),
  workers: Type.Array(transferWorkerSchema),
});

export type TransferWorker = Static<typeof transferWorkerSchema>;
export type TransferSector = Static<typeof transferSectorSchema>;
export type ListTransferOptionsResponse = Static<
  typeof listTransferOptionsResponseSchema
>;
