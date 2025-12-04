export interface IPasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export const validatePassword = (
  password: string
): IPasswordValidationResult => {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('password_minimum_8_characters');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('password_requires_lowercase');
  }

  if (!/[\d\W\s]/.test(password)) {
    errors.push('password_requires_number_symbol_or_whitespace');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};
