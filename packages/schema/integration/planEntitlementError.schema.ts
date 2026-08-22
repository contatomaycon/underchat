import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { Type, type TSchema } from '@sinclair/typebox';

const errorEnvelope = <T extends TSchema>(data: T, description: string) =>
  Type.Object(
    {
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Literal(false),
      message: Type.String(),
      data,
    },
    { description }
  );

const entitlementData = <TReason extends string>(reason: TReason) =>
  Type.Object({
    reason: Type.Literal(reason),
    plan_product_id: Type.Literal(EPlanProduct.integration),
  });

export const integrationPlanRequiredResponseSchema = errorEnvelope(
  entitlementData('integration_plan_required'),
  'O plano da conta não inclui o recurso Integração.'
);

export const planEntitlementUnavailableResponseSchema = errorEnvelope(
  entitlementData('plan_entitlement_unavailable'),
  'A fonte autoritativa de recursos do plano está temporariamente indisponível.'
);

export const integrationEntitlementEpochMismatchResponseSchema = errorEnvelope(
  entitlementData('integration_entitlement_epoch_mismatch'),
  'A revisão de Integração admitida pela requisição não é mais a revisão atual.'
);

export const integrationPlanErrorResponses = {
  402: integrationPlanRequiredResponseSchema,
  503: planEntitlementUnavailableResponseSchema,
};
