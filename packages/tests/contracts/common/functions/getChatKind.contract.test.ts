const isJidBroadcastMock = jest.fn();
const isJidGroupMock = jest.fn();
const isJidNewsletterMock = jest.fn();
const isJidStatusBroadcastMock = jest.fn();
const isLidUserMock = jest.fn();
const isPnUserMock = jest.fn();
const jidNormalizedUserMock = jest.fn((value: string) => value);

jest.mock('@whiskeysockets/baileys', () => ({
  isJidBroadcast: (value: string) => isJidBroadcastMock(value),
  isJidGroup: (value: string) => isJidGroupMock(value),
  isJidNewsletter: (value: string) => isJidNewsletterMock(value),
  isJidStatusBroadcast: (value: string) => isJidStatusBroadcastMock(value),
  isLidUser: (value: string) => isLidUserMock(value),
  isPnUser: (value: string) => isPnUserMock(value),
  jidNormalizedUser: (value: string) => jidNormalizedUserMock(value),
}));

import { EChatKind } from '@core/common/enums/EChatKind';
import {
  getChatKind,
  isGroupMessage,
} from '@core/common/functions/getChatKind';

describe('getChatKind/isGroupMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isJidBroadcastMock.mockReturnValue(false);
    isJidGroupMock.mockReturnValue(false);
    isJidNewsletterMock.mockReturnValue(false);
    isJidStatusBroadcastMock.mockReturnValue(false);
    isLidUserMock.mockReturnValue(false);
    isPnUserMock.mockReturnValue(false);
    jidNormalizedUserMock.mockImplementation((value: string) => value);
  });

  it('isGroupMessage returns true for group jid or participant', () => {
    isJidGroupMock.mockReturnValueOnce(true);
    expect(
      isGroupMessage({
        key: { remoteJid: '123@g.us' },
      } as never)
    ).toBe(true);

    isJidGroupMock.mockReturnValueOnce(false);
    expect(
      isGroupMessage({
        key: {
          remoteJid: '123@s.whatsapp.net',
          participant: 'x@s.whatsapp.net',
        },
      } as never)
    ).toBe(true);
  });

  it('isGroupMessage returns false for non-group without participant', () => {
    expect(
      isGroupMessage({
        key: { remoteJid: '123@s.whatsapp.net' },
      } as never)
    ).toBe(false);
  });

  it('returns unknown when jid is missing', () => {
    expect(getChatKind({ key: { remoteJid: null } } as never)).toBe(
      EChatKind.unknown
    );
  });

  it('returns group chat kind', () => {
    isJidGroupMock.mockReturnValue(true);
    expect(getChatKind({ key: { remoteJid: '123@g.us' } } as never)).toBe(
      EChatKind.group
    );
  });

  it('returns status chat kind', () => {
    isJidStatusBroadcastMock.mockReturnValue(true);
    expect(
      getChatKind({ key: { remoteJid: 'status@broadcast' } } as never)
    ).toBe(EChatKind.status);
  });

  it('returns broadcast chat kind', () => {
    isJidBroadcastMock.mockReturnValue(true);
    expect(getChatKind({ key: { remoteJid: 'list@broadcast' } } as never)).toBe(
      EChatKind.broadcast
    );
  });

  it('returns newsletter chat kind', () => {
    isJidNewsletterMock.mockReturnValue(true);
    expect(getChatKind({ key: { remoteJid: 'ch@newsletter' } } as never)).toBe(
      EChatKind.newsletter
    );
  });

  it('returns user for lid and pn users', () => {
    isLidUserMock.mockReturnValue(true);
    expect(getChatKind({ key: { remoteJid: '5511@lid' } } as never)).toBe(
      EChatKind.user
    );

    isLidUserMock.mockReturnValue(false);
    isPnUserMock.mockReturnValue(true);
    expect(getChatKind({ key: { remoteJid: '5511@pn' } } as never)).toBe(
      EChatKind.user
    );
  });

  it('returns unknown when no classifier matches', () => {
    expect(
      getChatKind({ key: { remoteJid: '5511@s.whatsapp.net' } } as never)
    ).toBe(EChatKind.unknown);
  });
});
