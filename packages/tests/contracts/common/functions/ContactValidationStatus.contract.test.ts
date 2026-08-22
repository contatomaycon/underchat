import {
  CONTACT_VALIDATION_STATUSES,
  resolveContactValidationStatus,
} from '@core/common/types/ContactValidationStatus';

describe('resolveContactValidationStatus', () => {
  it.each([
    [false, null, CONTACT_VALIDATION_STATUSES.notValidated],
    [null, 'official_assumed', CONTACT_VALIDATION_STATUSES.notValidated],
    [true, 'official_assumed', CONTACT_VALIDATION_STATUSES.officialOnly],
    [true, 'whatsapp_lookup', CONTACT_VALIDATION_STATUSES.validated],
    [true, 'official_inbound', CONTACT_VALIDATION_STATUSES.validated],
    [true, null, CONTACT_VALIDATION_STATUSES.validated],
  ] as const)(
    'maps isValidated=%s and origin=%s to %s',
    (isValidated, validationOrigin, expected) => {
      expect(
        resolveContactValidationStatus(isValidated, validationOrigin)
      ).toBe(expected);
    }
  );
});
