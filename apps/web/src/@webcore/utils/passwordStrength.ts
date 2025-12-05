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

  if (!/\d/.test(password) && !/[^\w]/.test(password)) {
    errors.push('password_requires_number_symbol_or_whitespace');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const calculateLengthScore = (length: number): number => {
  let score = 0;
  if (length >= 8) score += 20;
  if (length >= 12) score += 10;
  if (length >= 16) score += 10;
  return score;
};

const calculateCharacterScore = (
  password: string
): {
  score: number;
  feedback: string[];
} => {
  let score = 0;
  const feedback: string[] = [];

  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbolOrWhitespace = /[^\w]/.test(password);

  if (hasLowercase) {
    score += 15;
  }
  if (!hasLowercase) {
    feedback.push('password_requires_lowercase');
  }

  if (hasUppercase) {
    score += 15;
  }

  if (hasDigit) {
    score += 15;
  }

  if (hasSymbolOrWhitespace) {
    score += 15;
  }

  if (!hasDigit && !hasSymbolOrWhitespace) {
    feedback.push('password_requires_number_symbol_or_whitespace');
  }

  return { score, feedback };
};

const calculateVarietyScore = (password: string): number => {
  const uniqueChars = new Set(password).size;
  if (uniqueChars >= password.length * 0.7) {
    return 10;
  }
  return 0;
};

const determineStrength = (score: number): EPasswordStrength => {
  if (score < 40) {
    return EPasswordStrength.weak;
  }
  if (score < 60) {
    return EPasswordStrength.fair;
  }
  if (score < 80) {
    return EPasswordStrength.good;
  }
  return EPasswordStrength.strong;
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

  const lengthScore = calculateLengthScore(password.length);
  const { score: characterScore, feedback } = calculateCharacterScore(password);
  const varietyScore = calculateVarietyScore(password);

  const totalScore = lengthScore + characterScore + varietyScore;
  const strength = determineStrength(totalScore);

  return {
    strength,
    score: Math.min(100, totalScore),
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
