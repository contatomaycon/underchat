import { ERouteModule } from '@core/common/enums/ERouteModule';

export function getRootPath(routePath: string, module: ERouteModule): string {
  const normalizedPath = routePath.trim().startsWith('/')
    ? routePath.trim()
    : `/${routePath.trim()}`;
  const parts = normalizedPath.split('/');

  return `${module}/${parts[1]}`;
}
