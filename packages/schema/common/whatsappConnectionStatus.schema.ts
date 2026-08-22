import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { Type } from '@sinclair/typebox';

const safeDiagnosticTokenPattern = '^[a-z0-9][a-z0-9_.:-]{0,127}$';
const uuidSourcePattern =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const whatsappConnectionStatusSchema = Type.Object({
  provider: Type.Union([
    Type.Literal('baileys'),
    Type.Literal('wwebjs'),
    Type.Literal('whatsmeow'),
  ]),
  status: Type.Enum(EWhatsappConnectionStatus),
  connected: Type.Boolean(),
  authenticated: Type.Boolean(),
  sessionValid: Type.Union([Type.Boolean(), Type.Null()]),
  recoverable: Type.Boolean(),
  qrAvailable: Type.Boolean(),
  sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  changedAt: Type.String({ maxLength: 64 }),
  reason: Type.Optional(
    Type.String({ pattern: safeDiagnosticTokenPattern, maxLength: 128 })
  ),
  errorCode: Type.Optional(
    Type.String({ pattern: safeDiagnosticTokenPattern, maxLength: 128 })
  ),
});

export const whatsappConnectionStatusSourceIdSchema = Type.String({
  pattern: uuidSourcePattern,
  minLength: 36,
  maxLength: 36,
});

// PostgreSQL bigint is intentionally transported as a decimal string so the
// browser never loses outbox ordering precision through IEEE-754 coercion.
export const whatsappConnectionStatusOrderSchema = Type.String({
  pattern: '^[1-9][0-9]{0,18}$',
  minLength: 1,
  maxLength: 19,
});

export const whatsappConnectionStatusObservedAtSchema = Type.String({
  format: 'date-time',
  maxLength: 64,
});
