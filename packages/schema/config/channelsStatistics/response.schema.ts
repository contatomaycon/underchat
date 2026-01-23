import { Type, Static } from '@sinclair/typebox';

const statusStatisticSchema = Type.Object({
  total: Type.Number({ description: 'Total de canais com este status' }),
  percentage: Type.Number({
    description: 'Porcentagem que representa do total',
  }),
});

export const channelsStatisticsResponseSchema = Type.Object({
  online: statusStatisticSchema,
  disponible: statusStatisticSchema,
  new: statusStatisticSchema,
  offline: statusStatisticSchema,
  error: statusStatisticSchema,
  mismatched: statusStatisticSchema,
  stopped: statusStatisticSchema,
  total: Type.Number({ description: 'Total de canais não deletados' }),
});

export type ChannelsStatisticsResponse = Static<
  typeof channelsStatisticsResponseSchema
>;
