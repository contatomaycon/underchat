import { FastifyRequest } from 'fastify';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';

export function routePathWithoutPrefix(request: FastifyRequest): string | null {
  let routePath = request.routeOptions.url ?? request.raw.url ?? '';

  Object.values(EPrefixRoutes).forEach((prefix) => {
    routePath = routePath.replace(new RegExp(`/${prefix}`, 'g'), '');
  });

  return routePath ?? null;
}
