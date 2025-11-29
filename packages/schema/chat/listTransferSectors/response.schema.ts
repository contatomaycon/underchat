import { Static, Type } from '@sinclair/typebox';

export const transferSectorResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export type TransferSectorResponse = Static<
  typeof transferSectorResponseSchema
>;

export const listTransferSectorsResponseSchema = Type.Array(
  transferSectorResponseSchema
);

export type ListTransferSectorsResponse = Static<
  typeof listTransferSectorsResponseSchema
>;
