import {
  buildCandidates,
  buildCandidatesWithDdi,
} from '@core/common/functions/buildCandidatesBR';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { onlyDigits } from '@core/common/functions/onlyDigits';

const MIN_PHONE_WILDCARD_LENGTH = 3;
const MAX_PHONE_WILDCARD_TOKENS = 8;

const uniqueStable = (values: string[]): string[] => {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
};

const isLikelyBrazilLocalNumber = (digits: string): boolean => {
  return digits.length === 10 || digits.length === 11;
};

export type PhoneSearchTerms = {
  digits: string;
  candidates: string[];
  wildcardTokens: string[];
};

export function buildPhoneSearchTerms(rawInput: string): PhoneSearchTerms {
  const rawDigits = onlyDigits(rawInput ?? '');

  if (!rawDigits) {
    return {
      digits: '',
      candidates: [],
      wildcardTokens: [],
    };
  }

  const candidates: string[] = [];
  const appendCandidate = (value: string) => {
    const digits = onlyDigits(value);
    if (!digits) {
      return;
    }
    candidates.push(digits);
  };

  appendCandidate(rawDigits);

  // Handles values like +55..., +1..., and other explicit DDI formats.
  const extracted = extractPhoneAndDdi(rawInput);
  if (extracted?.phone) {
    const ddi = onlyDigits(extracted.phone_ddi ?? '');
    const localPhone = onlyDigits(extracted.phone);

    if (localPhone) {
      appendCandidate(localPhone);
    }

    if (ddi && localPhone) {
      appendCandidate(`${ddi}${localPhone}`);
    }

    if (ddi === '55' && localPhone) {
      const localVariants = buildCandidatesWithDdi(localPhone, ddi, {
        order: 'input_first',
      });
      for (const candidate of localVariants) {
        appendCandidate(candidate);
        appendCandidate(`${ddi}${candidate}`);
      }
    }
  }

  // Handles values already containing Brazil DDI (55...).
  const withDdiCandidates = buildCandidates(rawDigits, {
    order: 'input_first',
  });
  for (const candidate of withDdiCandidates) {
    appendCandidate(candidate);
    if (candidate.startsWith('55') && candidate.length > 2) {
      appendCandidate(candidate.slice(2));
    }
  }

  // Handles local BR values without DDI (DDD + number).
  if (!rawDigits.startsWith('55') && isLikelyBrazilLocalNumber(rawDigits)) {
    const localVariants = buildCandidatesWithDdi(rawDigits, '55', {
      order: 'input_first',
    });
    for (const candidate of localVariants) {
      appendCandidate(candidate);
      appendCandidate(`55${candidate}`);
    }
  }

  const normalizedCandidates = uniqueStable(candidates);
  const wildcardTokens = uniqueStable(
    [rawDigits, ...normalizedCandidates].filter(
      (candidate) => candidate.length >= MIN_PHONE_WILDCARD_LENGTH
    )
  ).slice(0, MAX_PHONE_WILDCARD_TOKENS);

  return {
    digits: rawDigits,
    candidates: normalizedCandidates,
    wildcardTokens,
  };
}
