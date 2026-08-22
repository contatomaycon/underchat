import { describe, expect, it } from '@jest/globals';
import { CONTACT_DOCUMENT_TYPE } from '../types/contact';
import {
  formatDocumentByType,
  getDocumentMaskMaxLength,
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeDocumentDigits,
} from '../utils/contactDocument';

describe('contactDocument utils', () => {
  it('formats CPF when type is CPF', () => {
    expect(formatDocumentByType('52998224725', CONTACT_DOCUMENT_TYPE.cpf)).toBe(
      '529.982.247-25'
    );
  });

  it('formats CNPJ when type is CNPJ', () => {
    expect(
      formatDocumentByType('04252011000110', CONTACT_DOCUMENT_TYPE.cnpj)
    ).toBe('04.252.011/0001-10');
    expect(
      formatDocumentByType('12abc34501de35', CONTACT_DOCUMENT_TYPE.cnpj)
    ).toBe('12.ABC.345/01DE-35');
  });

  it('validates CPF check digits', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('04.252.011/0001-10')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12.abc.345/01de-35')).toBe(true);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-AA')).toBe(false);
    expect(isValidCnpj('AB.123.CDE/4567-89')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-35XYZ')).toBe(false);
  });

  it('normalizes alphanumeric CNPJ to uppercase', () => {
    expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('respects max lengths by document type', () => {
    expect(getDocumentMaskMaxLength(CONTACT_DOCUMENT_TYPE.cpf)).toBe(14);
    expect(getDocumentMaskMaxLength(CONTACT_DOCUMENT_TYPE.cnpj)).toBe(18);
    expect(getDocumentMaskMaxLength(null)).toBe(18);
  });

  it('normalizes digits by document type', () => {
    expect(
      normalizeDocumentDigits('529.982.247-259999', CONTACT_DOCUMENT_TYPE.cpf)
    ).toBe('52998224725');
    expect(
      normalizeDocumentDigits(
        '12.abc.345/01de-359999',
        CONTACT_DOCUMENT_TYPE.cnpj
      )
    ).toBe('12ABC34501DE35');
  });
});
