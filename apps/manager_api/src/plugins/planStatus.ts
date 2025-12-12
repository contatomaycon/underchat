import { FastifyReply, FastifyRequest } from 'fastify';

export const planStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const active = request.tokenJwtData?.plan_is_active === true;
  reply.header('x-plan-active', active ? 'true' : 'false');

  const currentExpose = reply.getHeader('access-control-expose-headers');
  const exposeList = Array.isArray(currentExpose)
    ? currentExpose
    : typeof currentExpose === 'string'
      ? currentExpose
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [];

  const hasPlanHeader = exposeList.some(
    (h) => h.toLowerCase() === 'x-plan-active'
  );

  if (!hasPlanHeader) {
    const nextList = [...exposeList, 'x-plan-active'].filter(Boolean);
    reply.header('access-control-expose-headers', nextList.join(', '));
  }
};
