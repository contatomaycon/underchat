import { validatePassword } from '@core/common/utils/passwordValidator';

describe('validatePassword', () => {
  it('accepts valid passwords', () => {
    expect(validatePassword('abc12345')).toEqual({
      isValid: true,
      errors: [],
    });

    expect(validatePassword('abc defgh')).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it('returns all applicable validation errors', () => {
    expect(validatePassword('')).toEqual({
      isValid: false,
      errors: [
        'password_minimum_8_characters',
        'password_requires_lowercase',
        'password_requires_number_symbol_or_whitespace',
      ],
    });

    expect(validatePassword('ABCDEFGH')).toEqual({
      isValid: false,
      errors: [
        'password_requires_lowercase',
        'password_requires_number_symbol_or_whitespace',
      ],
    });

    expect(validatePassword('abcdefghi')).toEqual({
      isValid: false,
      errors: ['password_requires_number_symbol_or_whitespace'],
    });
  });
});
