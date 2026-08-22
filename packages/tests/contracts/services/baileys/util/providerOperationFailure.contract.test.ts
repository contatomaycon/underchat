import { Boom } from '@hapi/boom';
import {
  BaileysProviderProtocolFailureError,
  classifyBaileysProviderOperationFailure,
} from '@core/services/baileys/util/providerOperationFailure';

describe('Baileys provider operation failure classification', () => {
  it.each([
    ['not-authorized', 401, 'provider_not_authorized'],
    ['item-not-found', 404, 'provider_item_not_found'],
    ['forbidden', 403, 'provider_operation_forbidden'],
  ] as const)(
    'recognizes the legacy %s stanza shape as a definitive operation rejection',
    (message, data, reason) => {
      const error = new Boom(message, { data });

      expect(classifyBaileysProviderOperationFailure(error)).toEqual({
        kind: 'operation_rejected',
        reason,
        statusCode: data,
      });
    }
  );

  it('recognizes the corrected Boom status as a definitive operation rejection', () => {
    const error = new Boom('not-authorized', {
      statusCode: 401,
      data: 401,
    });

    expect(classifyBaileysProviderOperationFailure(error)).toEqual({
      kind: 'operation_rejected',
      reason: 'provider_not_authorized',
      statusCode: 401,
    });
  });

  it.each([
    [408, 'provider_connection_lost'],
    [428, 'provider_connection_closed'],
    [515, 'provider_restart_required'],
  ] as const)(
    'classifies provider status %s as transport failure',
    (code, reason) => {
      const error = new Boom('transport unavailable', {
        statusCode: code,
        data: code,
      });

      expect(classifyBaileysProviderOperationFailure(error)).toEqual({
        kind: 'transport',
        reason,
        statusCode: code,
      });
    }
  );

  it.each([
    [401, 'provider_session_logged_out'],
    [403, 'provider_session_forbidden'],
    [411, 'provider_multidevice_mismatch'],
    [440, 'provider_connection_replaced'],
    [500, 'provider_bad_session'],
  ] as const)(
    'keeps terminal session status %s separate from recoverable transport',
    (code, reason) => {
      const error = new Boom('stream ended', {
        statusCode: code,
        data: code,
      });

      expect(classifyBaileysProviderOperationFailure(error)).toEqual({
        kind: 'session_terminal',
        reason,
        statusCode: code,
      });
    }
  );

  it('recognizes a network error through a bounded causal chain', () => {
    const cause = Object.assign(new Error('details are not classified'), {
      code: 'ECONNRESET',
    });
    const error = new Error('provider wrapper', { cause });

    expect(classifyBaileysProviderOperationFailure(error)).toEqual({
      kind: 'transport',
      reason: 'provider_network_error',
    });
  });

  it('keeps an invalid resolved provider response eligible for bounded socket recovery', () => {
    const error = new BaileysProviderProtocolFailureError(
      'Failed to send message: missing key.id'
    );

    expect(classifyBaileysProviderOperationFailure(error)).toEqual({
      kind: 'protocol',
      reason: 'provider_protocol_invalid_response',
    });
  });

  it.each([
    new Error('not-authorized'),
    new Error('item-not-found'),
    new Error('not-authorized for a different internal invariant'),
    new Boom('item missing', { statusCode: 404 }),
    new Boom('provider unavailable', { statusCode: 503 }),
    new Error('arbitrary provider rejection'),
  ])('keeps unproven failures neutral to socket health', (error) => {
    expect(classifyBaileysProviderOperationFailure(error).kind).toBe('unknown');
  });

  it.each([
    ['bad-request', 400],
    ['item missing', 404],
    ['rate-overlimit', 429],
  ])(
    'does not mistake a legacy IQ %s response for Boom default bad-session status',
    (message, providerCode) => {
      const error = new Boom(message, { data: providerCode });

      expect(classifyBaileysProviderOperationFailure(error)).toEqual({
        kind: 'unknown',
        reason: 'provider_operation_response',
        statusCode: providerCode,
      });
    }
  );

  it('does not combine a rejection token with a transport code from its cause', () => {
    const cause = new Boom('Connection Closed', { statusCode: 428 });
    const error = new Error('not-authorized', { cause });

    expect(classifyBaileysProviderOperationFailure(error)).toEqual({
      kind: 'transport',
      reason: 'provider_connection_closed',
      statusCode: 428,
    });
  });

  it('does not invoke hostile accessors while classifying errors', () => {
    const error = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('must not be invoked');
      },
    });
    Object.defineProperty(error, 'cause', {
      get: () => {
        throw new Error('must not be invoked');
      },
    });

    expect(classifyBaileysProviderOperationFailure(error)).toEqual({
      kind: 'unknown',
      reason: 'unclassified_provider_error',
    });
  });
});
