import { ERouteModule } from '@core/common/enums/ERouteModule';
import { getRootPath } from '@core/common/functions/getRootPath';

describe('getRootPath', () => {
  it('normalizes path with leading slash and trims whitespace', () => {
    expect(getRootPath('  users/list ', ERouteModule.manager)).toBe(
      'manager/users'
    );
  });

  it('keeps first path segment when path already starts with slash', () => {
    expect(getRootPath('/dashboard/stats', ERouteModule.service)).toBe(
      'service/dashboard'
    );
  });
});
