import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user, userDocumentType } from '@core/models';

export const userDocument = pgTable(
  'user_document',
  {
    user_document_id: uuid().primaryKey().notNull(),
    user_document_type_id: uuid()
      .references(() => userDocumentType.user_document_type_id)
      .notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    document: varchar({ length: 500 }),
    document_partial: varchar({ length: 50 }),
    document_c: varchar({ length: 500 }),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('user_document_user_document_type_id_idx').on(
      table.user_document_type_id
    ),
    index('user_document_user_id_idx').on(table.user_id),
    index('user_document_document_partial_idx').on(table.document_partial),
    index('user_document_user_id_user_document_type_id_idx').on(
      table.user_id,
      table.user_document_type_id
    ),
    index('user_document_document_c_idx').on(table.document_c),
  ]
);

export const userDocumentRelations = relations(userDocument, ({ one }) => ({
  udt: one(userDocumentType, {
    fields: [userDocument.user_document_type_id],
    references: [userDocumentType.user_document_type_id],
  }),
  uud: one(user, {
    fields: [userDocument.user_id],
    references: [user.user_id],
  }),
}));
