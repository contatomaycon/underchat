import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('inactive plan runtime entitlement', () => {
  it('does not use catalog status while resolving an assigned current plan', () => {
    const source = readSource(
      'packages/repositories/planEntitlement/PlanEntitlement.repository.ts'
    );
    const runtimeResolution = source.slice(
      0,
      source.indexOf('async hasPotentialGrantAfterTestPlanActivation')
    );

    expect(runtimeResolution).toContain('p.deleted_at IS NULL');
    expect(runtimeResolution).toContain('next_payment_date >');
    expect(runtimeResolution).not.toContain('EPlanStatus.active');

    const prospectiveAssignment = source.slice(runtimeResolution.length);
    expect(prospectiveAssignment).toContain('p.status = ${EPlanStatus.active}');
  });

  it('keeps outbound capture, dispatch and redelivery independent from catalog status', () => {
    const sources = [
      readSource('packages/services/outboundWebhookEvent.service.ts'),
      readSource('packages/services/outboundWebhookDispatcherStore.ts'),
      readSource(
        'packages/repositories/outboundWebhook/OutboundWebhook.repository.ts'
      ),
    ];

    for (const source of sources) {
      expect(source).toContain('deleted_at IS NULL');
      expect(source).not.toContain('EPlanStatus');
      expect(source).not.toMatch(/(?:capture_|integration_)?plan\.status/);
    }
  });

  it('does not fence a catalog visibility update', () => {
    const source = readSource('packages/services/plan.service.ts');
    const updatePlan = source.slice(
      source.indexOf('updatePlan = async'),
      source.indexOf('deletePlan = async')
    );

    expect(updatePlan).toContain('planUpdaterRepository.updatePlan');
    expect(updatePlan).not.toContain('input.status');
    expect(updatePlan).not.toContain('installDenyFencesForPlan');
  });

  it('refreshes Integration authoritatively on every authentication flow', () => {
    const authenticationSources = [
      readSource('packages/useCases/auth/AuthLogin.useCase.ts'),
      readSource('packages/useCases/auth/AuthRefreshToken.useCase.ts'),
      readSource(
        'packages/useCases/auth/AuthForgotPasswordResetPassword.useCase.ts'
      ),
      readSource('packages/useCases/user/UserSessionLogin.useCase.ts'),
    ];

    for (const source of authenticationSources) {
      expect(source).toContain('bypassIntegrationCache: true');
    }
  });

  it('overrides the database reconciler and backfills existing grants', () => {
    const source = readSource('atlas/prod/20260711190000.sql');

    expect(source).toContain(
      'CREATE OR REPLACE FUNCTION "drain_integration_entitlement_revision_queue"()'
    );
    expect(source).not.toContain("status = 'active'");
    expect(source).toContain('latest.next_payment_date >');
    expect(source).toContain('p.deleted_at IS NULL');
    expect(source).toContain(
      'INSERT INTO "account_plan_product_entitlement_revision_queue"'
    );
    expect(source).toContain('ON CONFLICT');
  });
});
