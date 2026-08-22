import {
  formatCnpj,
  isCnpjFormat,
  normalizeCnpj,
  validateCnpj,
} from '@core/common/functions/validateCnpj';

describe('validateCnpj', () => {
  it('keeps validating numeric CNPJ values', () => {
    expect(validateCnpj('04.252.011/0001-10')).toBe(true);
    expect(validateCnpj('04.252.011/0001-11')).toBe(false);
    expect(validateCnpj('11.111.111/1111-11')).toBe(false);
  });

  it('validates alphanumeric CNPJ values using numeric check digits', () => {
    expect(validateCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(validateCnpj('12.abc.345/01de-35')).toBe(true);
    expect(validateCnpj('12.ABC.345/01DE-AA')).toBe(false);
    expect(validateCnpj('AB.123.CDE/4567-89')).toBe(false);
  });

  it('normalizes and formats alphanumeric CNPJ values', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(formatCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(isCnpjFormat('12.ABC.345/01DE-35')).toBe(true);
    expect(isCnpjFormat('12.ABC.345/01DE-AA')).toBe(false);
  });
});
