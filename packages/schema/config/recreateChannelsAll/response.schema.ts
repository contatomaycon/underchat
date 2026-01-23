import { Static, Type } from '@sinclair/typebox';

export const recreateChannelsAllResponseSchema = Type.Object({
  success: Type.Number({
    description: 'Número de canais recriados com sucesso',
  }),
  errors: Type.Number({
    description: 'Número de canais que falharam ao recriar',
  }),
});

export type RecreateChannelsAllResponse = Static<
  typeof recreateChannelsAllResponseSchema
>;
