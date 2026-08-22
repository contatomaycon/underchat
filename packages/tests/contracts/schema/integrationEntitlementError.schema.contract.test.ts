import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  integrationPlanRequiredResponseSchema,
  planEntitlementUnavailableResponseSchema,
} from '@core/schema/integration/planEntitlementError.schema';
import { receiveWebhookSchema } from '@core/schema/webhook/receiveWebhook';
import { Value } from '@sinclair/typebox/value';

const response = (reason: string) => ({
  id: 'request-1',
  status: false,
  message: reason,
  data: {
    reason,
    plan_product_id: EPlanProduct.integration,
  },
});

describe('Integration entitlement error schemas', () => {
  it('validates the exact 402 and 503 response contracts', () => {
    expect(
      Value.Check(
        integrationPlanRequiredResponseSchema,
        response('integration_plan_required')
      )
    ).toBe(true);
    expect(
      Value.Check(
        planEntitlementUnavailableResponseSchema,
        response('plan_entitlement_unavailable')
      )
    ).toBe(true);
  });

  it('documents inbound webhook entitlement and epoch failures', () => {
    expect(receiveWebhookSchema.response).toEqual(
      expect.objectContaining({
        402: integrationPlanRequiredResponseSchema,
        409: expect.any(Object),
        503: planEntitlementUnavailableResponseSchema,
      })
    );
  });
});
