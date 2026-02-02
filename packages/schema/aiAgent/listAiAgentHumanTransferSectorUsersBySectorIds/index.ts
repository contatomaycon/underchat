import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { listAiAgentHumanTransferSectorUsersResponseSchema } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsers/response.schema';
import { listAiAgentHumanTransferSectorUsersBySectorIdsQuerySchema } from './request.schema';

export const listAiAgentHumanTransferSectorUsersBySectorIdsSchema = {
  description:
    'Listar usuários de vários setores para atendimento humano do agente de IA',
  tags: [ETagSwagger.aiAgent],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: Type.Object({
    'Accept-Language': Type.Optional(
      Type.String({
        description: 'Idioma preferencial para a resposta',
        enum: Object.values(ELanguage),
        default: ELanguage.pt,
      })
    ),
  }),
  querystring: listAiAgentHumanTransferSectorUsersBySectorIdsQuerySchema,
  response: {
    200: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ const: true }),
      message: Type.String(),
      data: listAiAgentHumanTransferSectorUsersResponseSchema,
    }),
    401: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ default: false }),
      message: Type.String(),
      data: Type.Null(),
    }),
    500: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ default: false }),
      message: Type.String(),
      data: Type.Null(),
    }),
  },
};
