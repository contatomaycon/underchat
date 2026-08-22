import {
  getPlanEntitlementDenyFenceKey,
  getPlanEntitlementEpochKey,
} from '@core/common/constants/planEntitlement';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import type {
  PlanEntitlementAssertionOptions,
  PlanEntitlementResult,
} from '@core/common/interfaces/IPlanEntitlement';
import Redis from 'ioredis';
import { inject, singleton } from 'tsyringe';

interface CachedPlanEntitlement {
  readonly account_id: string;
  readonly plan_product_id: string;
  readonly allowed: boolean;
  readonly revision: string;
  readonly valid_until: string | null;
  readonly plan_is_active: boolean;
  readonly source: 'plan' | 'addon' | null;
}

const isGrantSource = (value: unknown): value is 'plan' | 'addon' =>
  value === 'plan' || value === 'addon';

/**
 * Resolves the integration entitlement published by the authoritative service.
 * Workers deliberately read only the Redis epoch/fence state and never fall
 * back to PostgreSQL.
 */
@singleton()
export class WorkerIntegrationEntitlementService {
  constructor(@inject('Redis') private readonly redis: Redis) {}

  public async assertEntitled(
    accountId: string,
    planProductId: string,
    options: PlanEntitlementAssertionOptions = {}
  ): Promise<PlanEntitlementResult> {
    if (planProductId !== EPlanProduct.integration) {
      throw new PlanEntitlementUnavailableError(
        'Worker entitlement resolver only supports integration access'
      );
    }

    if (!accountId || !options.expectedRevision) {
      throw new PlanEntitlementUnavailableError(
        'Worker entitlement lookup requires an account and revision'
      );
    }

    const entitlement = await this.readPublishedEntitlement(
      accountId,
      planProductId
    );

    if (!entitlement.allowed || !entitlement.planIsActive) {
      throw new PlanEntitlementDeniedError(entitlement);
    }

    if (!this.isValid(entitlement.validUntil)) {
      throw new PlanEntitlementDeniedError({
        ...entitlement,
        allowed: false,
      });
    }

    if (options.expectedRevision !== entitlement.revision) {
      throw new PlanEntitlementRevisionMismatchError(
        entitlement,
        options.expectedRevision
      );
    }

    return entitlement;
  }

  private async readPublishedEntitlement(
    accountId: string,
    planProductId: string
  ): Promise<PlanEntitlementResult> {
    let denyFenceRaw: string | null = null;
    let epochRaw: string | null = null;

    try {
      [denyFenceRaw, epochRaw] = await this.redis.mget(
        getPlanEntitlementDenyFenceKey(accountId, planProductId),
        getPlanEntitlementEpochKey(accountId, planProductId)
      );
    } catch (error) {
      throw new PlanEntitlementUnavailableError(
        'Worker could not read the published plan entitlement',
        error
      );
    }

    if (denyFenceRaw !== null) {
      const deniedEntitlement = this.parsePublishedEntitlement(
        denyFenceRaw,
        accountId,
        planProductId
      );
      if (!deniedEntitlement) {
        throw new PlanEntitlementUnavailableError(
          'Worker received an invalid plan entitlement deny fence'
        );
      }

      throw new PlanEntitlementDeniedError({
        ...deniedEntitlement,
        allowed: false,
      });
    }

    if (epochRaw === null) {
      throw new PlanEntitlementUnavailableError(
        'Worker plan entitlement epoch is unavailable'
      );
    }

    const entitlement = this.parsePublishedEntitlement(
      epochRaw,
      accountId,
      planProductId
    );
    if (!entitlement) {
      throw new PlanEntitlementUnavailableError(
        'Worker received an invalid plan entitlement epoch'
      );
    }

    return entitlement;
  }

  private parsePublishedEntitlement(
    raw: string,
    accountId: string,
    planProductId: string
  ): PlanEntitlementResult | null {
    try {
      const value = JSON.parse(raw) as Partial<CachedPlanEntitlement>;
      if (
        value.account_id !== accountId ||
        value.plan_product_id !== planProductId ||
        typeof value.allowed !== 'boolean' ||
        typeof value.revision !== 'string' ||
        !/^[1-9]\d*$/.test(value.revision) ||
        typeof value.plan_is_active !== 'boolean' ||
        (value.valid_until !== null && typeof value.valid_until !== 'string') ||
        (value.source !== null && !isGrantSource(value.source)) ||
        (value.allowed && value.valid_until === null) ||
        (value.allowed && !value.plan_is_active) ||
        (value.allowed && !isGrantSource(value.source)) ||
        (!value.allowed && value.source !== null)
      ) {
        return null;
      }

      if (
        value.valid_until !== null &&
        !Number.isFinite(new Date(value.valid_until).getTime())
      ) {
        return null;
      }

      return {
        accountId: value.account_id,
        planProductId: value.plan_product_id,
        allowed: value.allowed,
        revision: value.revision,
        validUntil: value.valid_until,
        planIsActive: value.plan_is_active,
        source: value.source,
      };
    } catch {
      return null;
    }
  }

  private isValid(validUntil: string | null): boolean {
    if (!validUntil) return false;
    return new Date(validUntil).getTime() > Date.now();
  }
}
