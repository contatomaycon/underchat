export interface ParsedAddress {
  street: string;
  number?: string;
  complement?: string;
}

const MAX_ADDRESS_LENGTH = 500;

const isDigit = (char: string): boolean => {
  return char >= '0' && char <= '9';
};

const findNumberStart = (text: string): number => {
  for (let i = 0; i < text.length; i++) {
    if (isDigit(text[i]!)) {
      return i;
    }
  }
  return text.length;
};

const findNumberEnd = (text: string, startIndex: number): number => {
  for (let i = startIndex; i < text.length; i++) {
    if (!isDigit(text[i]!)) {
      return i;
    }
  }
  return text.length;
};

const extractComplementStart = (text: string, numberEnd: number): number => {
  if (numberEnd >= text.length) {
    return numberEnd;
  }

  const char = text[numberEnd];
  if (char !== '-' && char !== '/') {
    return numberEnd;
  }

  let complementStart = numberEnd + 1;
  while (complementStart < text.length && isDigit(text[complementStart]!)) {
    complementStart++;
  }

  return complementStart;
};

const extractNumberAndComplement = (
  afterLastSpace: string
): { number: string; complement: string | undefined } | null => {
  const numberStart = findNumberStart(afterLastSpace);
  if (numberStart >= afterLastSpace.length) {
    return null;
  }

  const numberEnd = findNumberEnd(afterLastSpace, numberStart);
  const number = afterLastSpace.substring(numberStart, numberEnd);
  if (number.length === 0) {
    return null;
  }

  const complementStart = extractComplementStart(afterLastSpace, numberEnd);
  const complement =
    afterLastSpace.substring(complementStart).trim() || undefined;

  return { number, complement };
};

export const parseAddress = (address: string): ParsedAddress => {
  const trimmedAddress = address.trim();

  if (trimmedAddress.length > MAX_ADDRESS_LENGTH) {
    return {
      street: trimmedAddress,
    };
  }

  const lastSpaceIndex = trimmedAddress.lastIndexOf(' ');
  if (lastSpaceIndex === -1) {
    return {
      street: trimmedAddress,
    };
  }

  const afterLastSpace = trimmedAddress.substring(lastSpaceIndex + 1);
  if (afterLastSpace.length === 0) {
    return {
      street: trimmedAddress,
    };
  }

  const numberAndComplement = extractNumberAndComplement(afterLastSpace);
  if (!numberAndComplement) {
    return {
      street: trimmedAddress,
    };
  }

  const street = trimmedAddress.substring(0, lastSpaceIndex).trim();

  return {
    street: street || trimmedAddress,
    number: numberAndComplement.number,
    complement: numberAndComplement.complement,
  };
};
