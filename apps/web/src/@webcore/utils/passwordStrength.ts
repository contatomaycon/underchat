export enum EPasswordStrength {
  weak = 'weak',
  fair = 'fair',
  good = 'good',
  strong = 'strong',
}

export interface IPasswordStrength {
  strength: EPasswordStrength;
  score: number;
  feedback: string[];
}

export const validatePassword = (
  password: string
): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('minimum_eight_characters');
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

export const calculatePasswordStrength = (
  password: string
): IPasswordStrength => {
  if (!password) {
    return {
      strength: EPasswordStrength.weak,
      score: 0,
      feedback: [],
    };
  }

  let score = 0;
  const feedback: string[] = [];

  if (password.length >= 8) score += 20;
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;

  if (/[a-z]/.test(password)) {
    score += 15;
  }

  if (!/[a-z]/.test(password)) {
    feedback.push('password_requires_lowercase');
  }

  if (/[A-Z]/.test(password)) {
    score += 15;
  }

  if (/\d/.test(password)) {
    score += 15;
  }

  if (!/\d/.test(password) && !/[\W\s]/.test(password)) {
    feedback.push('password_requires_number_symbol_or_whitespace');
  }

  if (/[\W\s]/.test(password)) {
    score += 15;
  }

  if (!/[\W\s]/.test(password) && !/\d/.test(password)) {
    feedback.push('password_requires_number_symbol_or_whitespace');
  }

  const uniqueChars = new Set(password).size;
  if (uniqueChars >= password.length * 0.7) {
    score += 10;
  }

  let strength: EPasswordStrength = EPasswordStrength.strong;
  if (score < 40) {
    strength = EPasswordStrength.weak;
  }
  if (score >= 40 && score < 60) {
    strength = EPasswordStrength.fair;
  }
  if (score >= 60 && score < 80) {
    strength = EPasswordStrength.good;
  }

  return {
    strength,
    score: Math.min(100, score),
    feedback,
  };
};

export const getPasswordStrengthColor = (
  strength: EPasswordStrength
): string => {
  if (strength === EPasswordStrength.weak) {
    return 'error';
  }
  if (strength === EPasswordStrength.fair) {
    return 'warning';
  }
  if (strength === EPasswordStrength.good) {
    return 'info';
  }
  if (strength === EPasswordStrength.strong) {
    return 'success';
  }
  return 'error';
};

export const getPasswordStrengthLabel = (
  strength: EPasswordStrength,
  t: (key: string) => string
): string => {
  if (strength === EPasswordStrength.weak) {
    return t('password_strength_weak');
  }
  if (strength === EPasswordStrength.fair) {
    return t('password_strength_fair');
  }
  if (strength === EPasswordStrength.good) {
    return t('password_strength_good');
  }
  if (strength === EPasswordStrength.strong) {
    return t('password_strength_strong');
  }
  return t('password_strength_weak');
};
