import { FastifyRequest } from 'fastify';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';

export function routePathWithoutPrefix(request: FastifyRequest): string | null {
  let routePath = request.routeOptions.url ?? request.raw.url ?? '';
  for (const prefix of Object.values(EPrefixRoutes)) {
    routePath = routePath.replaceAll(`/${prefix}`, '');
  }

  return routePath ?? null;
}
