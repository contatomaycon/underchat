import { parseAddress } from '@core/common/functions/parseAddress';

describe('parseAddress', () => {
  it('returns only street when no number can be extracted', () => {
    expect(parseAddress('AvenidaPaulista')).toEqual({
      street: 'AvenidaPaulista',
    });
    expect(parseAddress('Avenida Paulista')).toEqual({
      street: 'Avenida Paulista',
    });
    expect(parseAddress('Rua sem número   ')).toEqual({
      street: 'Rua sem número',
    });
  });

  it('extracts street and number from the final token', () => {
    expect(parseAddress('Rua das Flores 123')).toEqual({
      street: 'Rua das Flores',
      number: '123',
      complement: undefined,
    });
  });

  it('keeps complement from first non-digit char when no separator exists', () => {
    expect(parseAddress('Rua D 123abc')).toEqual({
      street: 'Rua D',
      number: '123',
      complement: 'abc',
    });
  });

  it('extracts complement when separator is hyphen or slash followed by digits', () => {
    expect(parseAddress('Rua B 456-12apto8')).toEqual({
      street: 'Rua B',
      number: '456',
      complement: 'apto8',
    });

    expect(parseAddress('Rua C 789/34bloco2')).toEqual({
      street: 'Rua C',
      number: '789',
      complement: 'bloco2',
    });
  });

  it('returns only street for very large addresses', () => {
    const huge = `Rua ${'x'.repeat(600)} 123`;

    expect(parseAddress(huge)).toEqual({
      street: huge.trim(),
    });
  });
});
