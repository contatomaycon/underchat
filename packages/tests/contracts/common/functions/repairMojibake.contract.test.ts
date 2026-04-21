import {
  isLikelyMojibake,
  repairMojibake,
  repairMojibakeIfSafe,
} from '@core/common/functions/repairMojibake';

describe('repairMojibake helpers', () => {
  it('detects likely mojibake patterns', () => {
    expect(isLikelyMojibake('JosÃ©')).toBe(true);
    expect(isLikelyMojibake('José')).toBe(false);
    expect(isLikelyMojibake('')).toBe(false);
    expect(isLikelyMojibake(null)).toBe(false);
  });

  it('repairs latin1-decoded utf8 text', () => {
    expect(repairMojibake('JosÃ©')).toBe('José');
  });

  it('repairs only when safe and keeps original otherwise', () => {
    expect(repairMojibakeIfSafe('JosÃ©')).toBe('José');
    expect(repairMojibakeIfSafe('â\u0080')).toBe('â\u0080');
    expect(repairMojibakeIfSafe('texto normal')).toBe('texto normal');
    expect(repairMojibakeIfSafe(undefined)).toBeUndefined();
    expect(repairMojibakeIfSafe(null)).toBeNull();
  });

  it('keeps original when mocked repair returns same value', () => {
    const fromSpy = jest.spyOn(Buffer, 'from').mockImplementation(((
      value: string
    ) => {
      return {
        toString: () => value,
      } as never;
    }) as never);

    try {
      expect(repairMojibakeIfSafe('JosÃ©')).toBe('JosÃ©');
    } finally {
      fromSpy.mockRestore();
    }
  });

  it('keeps original when mocked repair remains likely mojibake', () => {
    const fromSpy = jest.spyOn(Buffer, 'from').mockImplementation((() => {
      return {
        toString: () => 'Ã©',
      } as never;
    }) as never);

    try {
      expect(repairMojibakeIfSafe('JosÃ©')).toBe('JosÃ©');
    } finally {
      fromSpy.mockRestore();
    }
  });
});
