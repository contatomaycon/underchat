import { setPlanActiveHeader } from '@core/common/functions/setPlanActiveHeader';
import { FastifyReply, FastifyRequest } from 'fastify';

export const planStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  setPlanActiveHeader(reply, request.tokenJwtData?.plan_is_active === true);
};
