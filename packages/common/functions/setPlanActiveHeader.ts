import { FastifyReply } from 'fastify';

export function setPlanActiveHeader(
  reply: FastifyReply,
  planIsActive: boolean
): void {
  const planHeaderValue = planIsActive ? 'true' : 'false';
  const currentExpose = reply.getHeader('access-control-expose-headers');
  let exposeList: string[] = [];

  if (Array.isArray(currentExpose)) {
    exposeList = currentExpose as string[];
  }

  if (!Array.isArray(currentExpose) && typeof currentExpose === 'string') {
    const parts = currentExpose.split(',');
    const cleaned: string[] = [];

    for (const value of parts) {
      const trimmed = value.trim();
      if (trimmed) {
        cleaned.push(trimmed);
      }
    }

    exposeList = cleaned;
  }

  let hasPlanHeader = false;

  for (const header of exposeList) {
    if (header.toLowerCase() === 'x-plan-active') {
      hasPlanHeader = true;
      break;
    }
  }

  let exposeHeaders = exposeList;

  if (!hasPlanHeader) {
    const nextList: string[] = [];

    for (const item of exposeList) {
      if (item) {
        nextList.push(item);
      }
    }

    nextList.push('x-plan-active');
    exposeHeaders = nextList;
  }

  reply.header('x-plan-active', planHeaderValue);
  reply.header('access-control-expose-headers', exposeHeaders.join(', '));
}
