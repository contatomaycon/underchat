import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';

describe('hasProtocolTag', () => {
  it('returns false for empty input', () => {
    expect(hasProtocolTag(undefined)).toBe(false);
    expect(hasProtocolTag(null)).toBe(false);
    expect(hasProtocolTag('')).toBe(false);
  });

  it('detects protocol placeholders in pt and en', () => {
    expect(hasProtocolTag('Seu número é {{ protocolo }}')).toBe(true);
    expect(hasProtocolTag('Ticket: {{protocol}}')).toBe(true);
  });

  it('returns false when placeholder is absent', () => {
    expect(hasProtocolTag('mensagem sem tag')).toBe(false);
  });
});
