import { proto } from '@whiskeysockets/baileys';
import { onlyDigits } from './onlyDigits';

export interface IPhoneAndDdi {
  phone: string;
  phone_ddi: string;
}

function tryBrazilDdi(digits: string): IPhoneAndDdi | null {
  if (digits.startsWith('55') && digits.length >= 12) {
    return {
      phone_ddi: '55',
      phone: digits.slice(2),
    };
  }
  return null;
}

function tryUsaCanadaDdi(digits: string): IPhoneAndDdi | null {
  if (digits.startsWith('1') && digits.length >= 11) {
    const remaining = digits.slice(1);
    if (remaining.length === 10) {
      return {
        phone_ddi: '1',
        phone: remaining,
      };
    }
  }
  return null;
}

function tryTwoDigitDdi(digits: string): IPhoneAndDdi | null {
  const twoDigitDdi = digits.slice(0, 2);
  const remainingTwo = digits.slice(2);

  if (remainingTwo.length < 8 || remainingTwo.length > 15) {
    return null;
  }

  const validTwoDigitDdis = [
    '55',
    '44',
    '33',
    '49',
    '39',
    '34',
    '31',
    '32',
    '46',
    '47',
    '48',
    '41',
    '43',
    '45',
    '52',
    '54',
    '56',
    '57',
    '58',
    '60',
    '61',
    '62',
    '63',
    '64',
    '65',
    '66',
    '81',
    '82',
    '84',
    '86',
    '90',
    '91',
    '92',
    '93',
    '94',
    '95',
    '98',
  ];

  if (validTwoDigitDdis.includes(twoDigitDdi)) {
    return {
      phone_ddi: twoDigitDdi,
      phone: remainingTwo,
    };
  }

  return null;
}

function tryThreeDigitDdi(digits: string): IPhoneAndDdi | null {
  const threeDigitDdi = digits.slice(0, 3);
  const remainingThree = digits.slice(3);

  if (remainingThree.length < 8 || remainingThree.length > 15) {
    return null;
  }

  const validThreeDigitDdis = [
    '351',
    '353',
    '354',
    '356',
    '357',
    '358',
    '359',
    '370',
    '371',
    '372',
    '373',
    '374',
    '375',
    '376',
    '377',
    '378',
    '380',
    '381',
    '382',
    '383',
    '385',
    '386',
    '387',
    '389',
    '420',
    '421',
    '423',
    '500',
    '501',
    '502',
    '503',
    '504',
    '505',
    '506',
    '507',
    '508',
    '509',
    '590',
    '591',
    '592',
    '593',
    '594',
    '595',
    '596',
    '597',
    '598',
    '599',
    '670',
    '672',
    '673',
    '674',
    '675',
    '676',
    '677',
    '678',
    '679',
    '680',
    '681',
    '682',
    '683',
    '684',
    '685',
    '686',
    '687',
    '688',
    '689',
    '850',
    '852',
    '853',
    '855',
    '856',
    '880',
    '886',
    '960',
    '961',
    '962',
    '963',
    '964',
    '965',
    '966',
    '967',
    '968',
    '970',
    '971',
    '972',
    '973',
    '974',
    '975',
    '976',
    '977',
    '992',
    '993',
    '994',
    '995',
    '996',
    '998',
  ];

  if (validThreeDigitDdis.includes(threeDigitDdi)) {
    return {
      phone_ddi: threeDigitDdi,
      phone: remainingThree,
    };
  }

  return null;
}

function tryFallbackPatterns(digits: string): IPhoneAndDdi | null {
  if (digits.length >= 12) {
    const potentialDdi = digits.slice(0, 2);
    const remaining = digits.slice(2);
    if (remaining.length >= 10 && remaining.length <= 15) {
      return {
        phone_ddi: potentialDdi,
        phone: remaining,
      };
    }
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return {
      phone_ddi: '1',
      phone: digits.slice(1),
    };
  }

  return null;
}

function extractWaidFromLine(
  line: string
): { waid: string; fullPhone: string } | null {
  const waidRegex = /waid=([^:;]+)\s*:\s*(.+)/;
  const waidMatch = waidRegex.exec(line);
  if (!waidMatch) return null;

  const waid = waidMatch[1].trim();
  const fullPhone = waidMatch[2].trim();
  if (!waid) return null;

  return { waid, fullPhone };
}

function extractPhoneFromLine(line: string): string | null {
  const telRegex = /\.?TEL[^:]*:\s*(.+)/;
  const telMatch = telRegex.exec(line);
  if (!telMatch) return null;

  const phone = telMatch[1].trim();
  return phone || null;
}

function extractPhoneFromVCard(
  vcard: string
): { waid?: string; fullPhone?: string; phone?: string } | null {
  if (!vcard) return null;

  const lines = vcard.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.includes('TEL')) continue;

    const waidResult = extractWaidFromLine(trimmed);
    if (waidResult) {
      return waidResult;
    }

    const phone = extractPhoneFromLine(trimmed);
    if (phone) {
      return { phone };
    }
  }

  return null;
}

export function extractPhoneAndDdi(
  phoneValue: string | null | undefined
): IPhoneAndDdi | null {
  if (!phoneValue) return null;

  const hasPlus = phoneValue.trim().startsWith('+');
  const digits = onlyDigits(phoneValue);

  if (!digits || digits.length < 8) return null;

  if (!hasPlus && digits.length < 10) return null;

  const brazilResult = tryBrazilDdi(digits);
  if (brazilResult) return brazilResult;

  const usaCanadaResult = tryUsaCanadaDdi(digits);
  if (usaCanadaResult) return usaCanadaResult;

  const twoDigitResult = tryTwoDigitDdi(digits);
  if (twoDigitResult) return twoDigitResult;

  const threeDigitResult = tryThreeDigitDdi(digits);
  if (threeDigitResult) return threeDigitResult;

  const fallbackResult = tryFallbackPatterns(digits);
  if (fallbackResult) return fallbackResult;

  return null;
}

function processFullPhoneFromWaid(
  fullPhone: string | undefined
): IPhoneAndDdi | null {
  const fullPhoneTrimmed = fullPhone?.trim();
  if (!fullPhoneTrimmed) return null;

  const fullPhoneWithPlus = fullPhoneTrimmed.startsWith('+')
    ? fullPhoneTrimmed
    : `+${fullPhoneTrimmed}`;

  return extractPhoneAndDdi(fullPhoneWithPlus);
}

function processWaid(waid: string): IPhoneAndDdi | null {
  const waidDigits = onlyDigits(waid);
  if (!waidDigits) return null;

  const waidWithPlus = `+${waidDigits}`;
  return extractPhoneAndDdi(waidWithPlus);
}

function processWaidData(
  extracted: { waid?: string; fullPhone?: string; phone?: string }
): IPhoneAndDdi | null {
  if (!extracted.waid) return null;

  const fullPhoneResult = processFullPhoneFromWaid(extracted.fullPhone);
  if (fullPhoneResult) {
    return fullPhoneResult;
  }

  return processWaid(extracted.waid);
}

export function extractPhoneAndDdiFromContactMessage(
  contactMessage: proto.Message.IContactMessage | null | undefined
): IPhoneAndDdi | null {
  if (!contactMessage?.vcard) return null;

  const vcard = contactMessage.vcard;
  const extracted = extractPhoneFromVCard(vcard);
  if (!extracted) return null;

  const waidResult = processWaidData(extracted);
  if (waidResult) return waidResult;

  return extractPhoneAndDdi(extracted.phone);
}
