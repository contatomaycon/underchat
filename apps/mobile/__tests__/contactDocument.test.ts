import { CONTACT_DOCUMENT_TYPE } from '../types/contact';
import {
  formatDocumentByType,
  getDocumentMaskMaxLength,
  isValidCnpj,
  isValidCpf,
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
  });

  it('validates CPF check digits', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('04.252.011/0001-10')).toBe(true);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
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
        '04.252.011/0001-109999',
        CONTACT_DOCUMENT_TYPE.cnpj
      )
    ).toBe('04252011000110');
  });
});
