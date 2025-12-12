import { FastifyReply, FastifyRequest } from 'fastify';

export const planStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const active = request.tokenJwtData?.plan_is_active === true;
  reply.header('x-plan-active', active ? 'true' : 'false');
};
