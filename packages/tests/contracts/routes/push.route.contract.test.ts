import fs from 'node:fs';
import path from 'node:path';
import { getPushPublicKeySchema } from '@core/schema/push/getPublicKey';

const pushRouteSource = fs.readFileSync(
  path.resolve(process.cwd(), 'apps/manager_api/src/routes/push.route.ts'),
  'utf8'
);

function getRouteBlock(method: 'get' | 'post' | 'delete', pathName: string) {
  const marker = `server.${method}('${pathName}', {`;
  const start = pushRouteSource.indexOf(marker);

  if (start === -1) {
    throw new Error(`Route ${method.toUpperCase()} ${pathName} not found`);
  }

  const end = pushRouteSource.indexOf('\n  });', start);
  return pushRouteSource.slice(start, end);
}

describe('push route authentication boundaries', () => {
  it('keeps the VAPID public key route public', () => {
    const schema = getPushPublicKeySchema as {
      security?: unknown;
      response: Record<number, unknown>;
    };
    const publicKeyRoute = getRouteBlock('get', '/push/public-key');

    expect(schema.security).toBeUndefined();
    expect(schema.response[401]).toBeUndefined();
    expect(schema.response[403]).toBeUndefined();
    expect(publicKeyRoute).not.toContain('authenticateJwt');
    expect(publicKeyRoute).not.toContain('preHandler');
  });

  it('keeps subscription mutations authenticated', () => {
    expect(getRouteBlock('post', '/push/subscribe')).toContain(
      'authenticateJwt'
    );
    expect(getRouteBlock('delete', '/push/unsubscribe')).toContain(
      'authenticateJwt'
    );
  });
});
