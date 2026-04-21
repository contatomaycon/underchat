import 'reflect-metadata';

const mockOnlyDigits = jest.fn((value: string) => value.replace(/\D/g, ''));
const mockNormalizeJid = jest.fn((jid: string) => jid);
const mockBuildCandidates = jest.fn((value: string) => [value]);
const mockGetPhoneNumber = jest.fn<string | undefined, [string]>(
  (jid: string) => jid.split('@')[0]
);

jest.mock('@core/common/functions/onlyDigits', () => ({
  onlyDigits: (value: string) => mockOnlyDigits(value),
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (jid: string) => mockNormalizeJid(jid),
}));

jest.mock('@core/common/functions/buildCandidatesBR', () => ({
  buildCandidates: (value: string) => mockBuildCandidates(value),
}));

jest.mock('@core/common/functions/getPhoneNumber', () => ({
  getPhoneNumber: (jid: string) => mockGetPhoneNumber(jid),
}));

jest.mock('@core/services/wwebjs/methods/connection.service', () => ({
  WwebjsConnectionService: class {},
}));

import { WwebjsPhoneValidationService } from '@core/services/wwebjs/methods/phoneValidation.service';

describe('WwebjsPhoneValidationService', () => {
  const makeService = () => {
    const client = {
      onWhatsApp: jest.fn(),
    };

    const connection = {
      getSocket: jest.fn(() => client),
    };

    const service = new WwebjsPhoneValidationService(connection as never);

    return {
      service,
      connection,
      client,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnlyDigits.mockImplementation((value: string) =>
      value.replace(/\D/g, '')
    );
    mockNormalizeJid.mockImplementation((jid: string) => jid);
    mockBuildCandidates.mockImplementation((value: string) => [value]);
    mockGetPhoneNumber.mockImplementation((jid: string) => jid.split('@')[0]);
  });

  it('validates helper methods for phone normalization and lid rules', () => {
    const { service } = makeService();
    const sut = service as unknown as {
      normalizePhoneDigits: (value?: string | null) => string | undefined;
      isResolvedPhoneEquivalentToLid: (
        lidJid: string,
        resolvedPhone: string
      ) => boolean;
      isResolvedPhoneFromLidReliable: (
        lidJid: string,
        resolvedPhone: string,
        candidates: string[]
      ) => boolean;
      getLidDiscardReason: (
        lidJid: string,
        resolvedPhone: string | undefined,
        candidates: string[]
      ) => 'not_found' | 'lid_equivalent' | 'candidate_mismatch';
    };

    expect(sut.normalizePhoneDigits(undefined)).toBeUndefined();
    expect(sut.normalizePhoneDigits('(11) 99999-0000')).toBe('11999990000');

    expect(
      sut.isResolvedPhoneEquivalentToLid('5511999990000@lid', '5511999990000')
    ).toBe(true);
    expect(
      sut.isResolvedPhoneEquivalentToLid('5511999990000@lid', '5511888887777')
    ).toBe(false);

    expect(
      sut.isResolvedPhoneFromLidReliable('5511999990000@lid', '5511888887777', [
        '5511888887777',
      ])
    ).toBe(true);

    expect(
      sut.isResolvedPhoneFromLidReliable('5511999990000@lid', '5511999990000', [
        '5511999990000',
      ])
    ).toBe(false);
    expect(
      sut.isResolvedPhoneFromLidReliable('5511999990000@lid', '5511777776666', [
        '5511888887777',
      ])
    ).toBe(false);

    expect(
      sut.getLidDiscardReason('5511999990000@lid', undefined, ['5511'])
    ).toBe('not_found');
    expect(
      sut.getLidDiscardReason('5511999990000@lid', '5511999990000', [
        '5511999990000',
      ])
    ).toBe('lid_equivalent');
    expect(
      sut.getLidDiscardReason('5511999990000@lid', '5511777776666', [
        '5511888887777',
      ])
    ).toBe('candidate_mismatch');
    expect(
      sut.getLidDiscardReason('5511999990000@lid', '5511888887777', [
        '5511888887777',
      ])
    ).toBe('not_found');
  });

  it('resolvePhoneFromLid handles unavailable/invalid/failed client responses', async () => {
    const { service } = makeService();
    const sut = service as unknown as {
      resolvePhoneFromLid: (
        client: { onWhatsApp?: (input: string[]) => Promise<Array<any>> },
        lidJid: string
      ) => Promise<string | undefined>;
    };

    await expect(
      sut.resolvePhoneFromLid({}, '5511999990000@lid')
    ).resolves.toBeUndefined();

    await expect(
      sut.resolvePhoneFromLid(
        {
          onWhatsApp: async () => [{ exists: false, jid: '5511@c.us' }],
        },
        '5511999990000@lid'
      )
    ).resolves.toBeUndefined();

    await expect(
      sut.resolvePhoneFromLid(
        {
          onWhatsApp: async () => [{ exists: true, jid: '5511999990000@lid' }],
        },
        '5511999990000@lid'
      )
    ).resolves.toBeUndefined();

    await expect(
      sut.resolvePhoneFromLid(
        {
          onWhatsApp: async () => {
            throw new Error('socket down');
          },
        },
        '5511999990000@lid'
      )
    ).resolves.toBeUndefined();

    await expect(
      sut.resolvePhoneFromLid(
        {
          onWhatsApp: async () => [{ exists: true, jid: '5511888887777@c.us' }],
        },
        '5511999990000@lid'
      )
    ).resolves.toBe('5511888887777');
  });

  it('resolveReliablePhoneFromLidWithRetry returns in first reliable attempt and retries until exhaustion', async () => {
    const { service } = makeService();
    const sut = service as unknown as {
      resolveReliablePhoneFromLidWithRetry: (
        client: unknown,
        lidJid: string,
        candidates: string[]
      ) => Promise<{
        phone?: string;
        attempts: number;
        lastResolvedPhone?: string;
      }>;
      sleep: (ms: number) => Promise<void>;
      resolvePhoneFromLid: (
        client: unknown,
        lidJid: string
      ) => Promise<string | undefined>;
    };

    const sleepSpy = jest.spyOn(sut, 'sleep').mockResolvedValue(undefined);

    const resolveSpy = jest
      .spyOn(sut, 'resolvePhoneFromLid')
      .mockResolvedValueOnce('5511888887777');

    await expect(
      sut.resolveReliablePhoneFromLidWithRetry({}, '5511999990000@lid', [
        '5511888887777',
      ])
    ).resolves.toEqual({
      phone: '5511888887777',
      attempts: 1,
      lastResolvedPhone: '5511888887777',
    });

    resolveSpy.mockReset();
    resolveSpy
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('5511999990000')
      .mockResolvedValueOnce('5511777776666');

    await expect(
      sut.resolveReliablePhoneFromLidWithRetry({}, '5511999990000@lid', [
        '5511888887777',
      ])
    ).resolves.toEqual({
      attempts: 3,
      lastResolvedPhone: '5511777776666',
    });

    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when client is not connected', async () => {
    const connection = {
      getSocket: jest.fn(() => undefined),
    };
    const service = new WwebjsPhoneValidationService(connection as never);

    await expect(service.validatePhone('55', '11999990000')).rejects.toThrow(
      'Wwebjs client not connected'
    );
  });

  it('returns valid number from non-lid jid and extracted phone number', async () => {
    const { service, client } = makeService();

    mockBuildCandidates.mockReturnValue(['5511999990000']);
    client.onWhatsApp.mockResolvedValue([
      { exists: true, jid: '5511888887777@c.us' },
    ]);
    mockGetPhoneNumber.mockReturnValue('5511888887777');

    await expect(service.validatePhone('55', '11999990000')).resolves.toEqual({
      valid: true,
      jid: '5511888887777@c.us',
      phone: '5511888887777',
    });
  });

  it('uses candidate as fallback when non-lid jid has no extractable phone', async () => {
    const { service, client } = makeService();

    mockBuildCandidates.mockReturnValue(['5511999990000']);
    client.onWhatsApp.mockResolvedValue([
      { exists: true, jid: 'jid-without-number@c.us' },
    ]);
    mockGetPhoneNumber.mockReturnValue(undefined);

    await expect(service.validatePhone('55', '11999990000')).resolves.toEqual({
      valid: true,
      jid: 'jid-without-number@c.us',
      phone: '5511999990000',
    });
  });

  it('resolves lid jid to reliable phone and returns fallback lid candidate when unresolved', async () => {
    const { service, client } = makeService();
    const sut = service as unknown as {
      resolveReliablePhoneFromLidWithRetry: (
        client: unknown,
        lidJid: string,
        candidates: string[]
      ) => Promise<{ phone?: string }>;
    };

    mockBuildCandidates.mockReturnValue(['5511999990000', '5511888887777']);

    client.onWhatsApp
      .mockResolvedValueOnce([{ exists: true, jid: '5511999990000@lid' }])
      .mockResolvedValueOnce([{ exists: true, jid: '5511888887777@lid' }])
      .mockResolvedValueOnce([{ exists: false, jid: null }]);

    const lidResolveSpy = jest
      .spyOn(sut, 'resolveReliablePhoneFromLidWithRetry')
      .mockResolvedValueOnce({ phone: '5511777776666' })
      .mockResolvedValueOnce({ phone: undefined });

    await expect(service.validatePhone('55', '11999990000')).resolves.toEqual({
      valid: true,
      jid: '5511999990000@lid',
      phone: '5511777776666',
    });

    await expect(service.validatePhone('55', '11888887777')).resolves.toEqual({
      valid: true,
      jid: '5511888887777@lid',
      phone: '5511999990000',
    });

    expect(lidResolveSpy).toHaveBeenCalledTimes(2);
  });

  it('returns invalid=false when all candidates miss', async () => {
    const { service, client } = makeService();

    mockBuildCandidates.mockReturnValue(['5511999990000', '5511888887777']);

    client.onWhatsApp
      .mockResolvedValueOnce([{ exists: false, jid: null }])
      .mockResolvedValueOnce([{ exists: false, jid: null }]);

    await expect(service.validatePhone('55', '11999990000')).resolves.toEqual({
      valid: false,
    });
  });
});
