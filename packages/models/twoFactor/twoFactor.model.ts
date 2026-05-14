import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const twoFactor = pgTable(
  'two_factor',
  {
    two_factor_id: uuid().primaryKey().notNull(),
    user_id: uuid().references(() => user.user_id),
    phone_ddi: varchar({ length: 5 }),
    phone: varchar({ length: 500 }),
    phone_partial: varchar({ length: 15 }),
    phone_c: varchar({ length: 500 }),
    email: varchar({ length: 500 }),
    email_partial: varchar({ length: 50 }),
    email_c: varchar({ length: 500 }),
    code: varchar({ length: 64 }).notNull(),
    token: varchar({ length: 255 }).notNull(),
    worker_id: uuid(),
    worker_number: varchar({ length: 20 }),
    validation_context: varchar({ length: 30 }),
    validated_at: timestamp({ mode: 'string', withTimezone: true }),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('two_factor_user_id_idx').on(table.user_id),
    index('two_factor_token_idx').on(table.token),
    index('two_factor_code_idx').on(table.code),
    index('two_factor_worker_id_idx').on(table.worker_id),
    index('two_factor_validation_context_idx').on(table.validation_context),
    index('two_factor_validated_at_idx').on(table.validated_at),
    index('two_factor_deleted_at_idx').on(table.deleted_at),
    index('two_factor_email_c_phone_c_code_deleted_at_idx').on(
      table.email_c,
      table.phone_c,
      table.code,
      table.deleted_at
    ),
    index('two_factor_email_c_phone_c_token_idx').on(
      table.email_c,
      table.phone_c,
      table.token
    ),
  ]
);

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  uud: one(user, {
    fields: [twoFactor.user_id],
    references: [user.user_id],
  }),
}));
