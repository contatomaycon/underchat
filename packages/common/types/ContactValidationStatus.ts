import {
  CONTACT_VALIDATION_ORIGINS,
  type ContactValidationOrigin,
} from './ContactValidationOrigin';

export const CONTACT_VALIDATION_STATUSES = {
  validated: 'validated',
  officialOnly: 'official_only',
  notValidated: 'not_validated',
} as const;

export type ContactValidationStatus =
  (typeof CONTACT_VALIDATION_STATUSES)[keyof typeof CONTACT_VALIDATION_STATUSES];

export const resolveContactValidationStatus = (
  isValidated: boolean | null | undefined,
  validationOrigin: ContactValidationOrigin | null | undefined
): ContactValidationStatus => {
  if (isValidated !== true) {
    return CONTACT_VALIDATION_STATUSES.notValidated;
  }

  if (validationOrigin === CONTACT_VALIDATION_ORIGINS.officialAssumed) {
    return CONTACT_VALIDATION_STATUSES.officialOnly;
  }

  return CONTACT_VALIDATION_STATUSES.validated;
};
