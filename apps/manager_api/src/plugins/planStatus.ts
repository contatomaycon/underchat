import { FastifyReply, FastifyRequest } from 'fastify';

export const planStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const active = request.tokenJwtData?.plan_is_active === true;
  reply.header('x-plan-active', active ? 'true' : 'false');

  const currentExpose = reply.getHeader('access-control-expose-headers');
  let exposeList: string[] = [];

  if (Array.isArray(currentExpose)) {
    exposeList = currentExpose;
  }

  if (!Array.isArray(currentExpose) && typeof currentExpose === 'string') {
    exposeList = currentExpose
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  const hasPlanHeader = exposeList.some(
    (h) => h.toLowerCase() === 'x-plan-active'
  );

  if (!hasPlanHeader) {
    const nextList = [...exposeList, 'x-plan-active'].filter(Boolean);
    reply.header('access-control-expose-headers', nextList.join(', '));
  }
};
