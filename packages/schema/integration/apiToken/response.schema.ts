import { Static, Type } from '@sinclair/typebox';

export const publicApiTokenStatusSchema = Type.Union(
  [
    Type.Literal('active'),
    Type.Literal('revoked'),
    Type.Literal('not_configured'),
  ],
  {
    description: 'Estado atual da credencial da API pública.',
    examples: ['active'],
  }
);

const nullableUuidSchema = Type.Union([
  Type.String({ format: 'uuid' }),
  Type.Null(),
]);
const nullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const nullableDateTimeSchema = Type.Union([
  Type.String({ format: 'date-time' }),
  Type.Null(),
]);

export const publicApiTokenResponseSchema = Type.Object({
  configured: Type.Boolean({
    description: 'Indica se a conta possui um token ativo.',
    examples: [true],
  }),
  token_id: nullableUuidSchema,
  status: publicApiTokenStatusSchema,
  token: Type.Union([
    Type.String({
      description:
        'Token completo. É retornado pelo Manager porque a credencial é armazenada criptografada.',
      examples: ['uc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'],
    }),
    Type.Null(),
  ]),
  token_preview: nullableStringSchema,
  actor_user_id: nullableUuidSchema,
  actor_user_name: nullableStringSchema,
  created_at: nullableDateTimeSchema,
  updated_at: nullableDateTimeSchema,
  rotated_at: nullableDateTimeSchema,
  last_used_at: nullableDateTimeSchema,
  revoked_at: nullableDateTimeSchema,
});

export type PublicApiTokenResponse = Static<
  typeof publicApiTokenResponseSchema
>;
