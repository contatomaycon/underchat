import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { sanitizationMap } from '@core/common/functions/sanitizeValue';

describe('sanitizationMap', () => {
  it('sanitizes document values for cpf, cnpj and fallback', () => {
    expect(sanitizationMap[ETypeSanetize.document]('12345678901')).toBe(
      '123.***.***-01'
    );
    expect(sanitizationMap[ETypeSanetize.document]('12345678000199')).toBe(
      '12.***.***/****-99'
    );
    expect(sanitizationMap[ETypeSanetize.document]('ABCD')).toBe('**CD');
  });

  it('sanitizes email values with validations', () => {
    expect(sanitizationMap[ETypeSanetize.email]('john@example.com')).toBe(
      'jo**@example.com'
    );
    expect(sanitizationMap[ETypeSanetize.email]('ab@example.com')).toBe(
      '**************'
    );
    expect(sanitizationMap[ETypeSanetize.email]('invalid-email')).toBe(
      '*************'
    );
  });

  it('sanitizes phone values by different lengths', () => {
    expect(sanitizationMap[ETypeSanetize.phone]('(11) 99999-1234')).toBe(
      '(11) *****-1234'
    );
    expect(sanitizationMap[ETypeSanetize.phone]('1199991234')).toBe(
      '(11) ****-1234'
    );
    expect(sanitizationMap[ETypeSanetize.phone]('551199991234')).toBe(
      '(55) ******-1234'
    );
    expect(sanitizationMap[ETypeSanetize.phone]('99991234')).toBe('****-1234');
    expect(sanitizationMap[ETypeSanetize.phone]('11')).toBe('*1');
    expect(sanitizationMap[ETypeSanetize.phone]('---')).toBe('---');
  });

  it('sanitizes other values with quarter masking strategy', () => {
    expect(sanitizationMap[ETypeSanetize.other]('abcdefghi')).toBe('***def***');
    expect(sanitizationMap[ETypeSanetize.other]('ab')).toBe('**');
  });
});
