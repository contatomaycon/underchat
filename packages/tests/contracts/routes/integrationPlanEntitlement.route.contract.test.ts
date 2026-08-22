import fs from 'node:fs';
import path from 'node:path';

describe('manager Integration route entitlement contract', () => {
  it('keeps every administrative Integration route behind permission then plan guard', () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'apps/manager_api/src/routes/integration.route.ts'
      ),
      'utf8'
    );
    const routeCount = (
      source.match(/server\.(?:get|post|patch|delete)\s*\(/g) ?? []
    ).length;
    const guardedRouteCount = (
      source.match(/preHandler:\s*integrationPreHandlers\s*\(/g) ?? []
    ).length;
    const documentedRouteCount = (
      source.match(/schema:\s*withIntegrationPlanResponses\s*\(/g) ?? []
    ).length;

    expect(routeCount).toBeGreaterThan(0);
    expect(guardedRouteCount).toBe(routeCount);
    expect(documentedRouteCount).toBe(routeCount);
    expect(source).toContain(
      'const integrationProductGuard = planProductGuard(EPlanProduct.integration)'
    );
    expect(source).toMatch(
      /const integrationPreHandlers[\s\S]*server\.authenticateJwt[\s\S]*integrationProductGuard/
    );
    expect(source).toMatch(
      /outbound-webhooks\/:id\/test[\s\S]*409:\s*integrationEntitlementEpochMismatchResponseSchema/
    );
  });
});
