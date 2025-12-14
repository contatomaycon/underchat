import { FastifyReply } from 'fastify';

const PLAN_ACTIVE_HEADER = 'x-plan-active';

function parseExposeHeaders(
  currentExpose: string | number | string[] | undefined
): string[] {
  if (Array.isArray(currentExpose)) {
    return currentExpose;
  }

  if (typeof currentExpose === 'string') {
    const parts = currentExpose.split(',');
    const cleaned: string[] = [];

    for (const value of parts) {
      const trimmed = value.trim();
      if (trimmed) {
        cleaned.push(trimmed);
      }
    }

    return cleaned;
  }

  if (typeof currentExpose === 'number') {
    return [currentExpose.toString()];
  }

  return [];
}

function hasPlanActiveHeader(exposeList: string[]): boolean {
  for (const header of exposeList) {
    if (header.toLowerCase() === PLAN_ACTIVE_HEADER) {
      return true;
    }
  }

  return false;
}

function addPlanActiveHeader(exposeList: string[]): string[] {
  const filtered = exposeList.filter(Boolean);
  filtered.push(PLAN_ACTIVE_HEADER);
  return filtered;
}

export function setPlanActiveHeader(
  reply: FastifyReply,
  planIsActive: boolean
): void {
  const planHeaderValue = planIsActive ? 'true' : 'false';
  const currentExpose = reply.getHeader('access-control-expose-headers');
  const exposeList = parseExposeHeaders(currentExpose);

  let exposeHeaders = exposeList;

  if (!hasPlanActiveHeader(exposeList)) {
    exposeHeaders = addPlanActiveHeader(exposeList);
  }

  reply.header(PLAN_ACTIVE_HEADER, planHeaderValue);
  reply.header('access-control-expose-headers', exposeHeaders.join(', '));
}
