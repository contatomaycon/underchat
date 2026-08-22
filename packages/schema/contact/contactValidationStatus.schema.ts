import { Type } from '@sinclair/typebox';
import { CONTACT_VALIDATION_STATUSES } from '@core/common/types/ContactValidationStatus';

export const contactValidationStatusSchema = Type.Union([
  Type.Literal(CONTACT_VALIDATION_STATUSES.validated),
  Type.Literal(CONTACT_VALIDATION_STATUSES.officialOnly),
  Type.Literal(CONTACT_VALIDATION_STATUSES.notValidated),
]);
