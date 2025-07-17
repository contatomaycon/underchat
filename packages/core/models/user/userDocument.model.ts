import { pgTable, timestamp, varchar, smallint } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { userDocumentType } from '@core/models';

export const userDocument = pgTable('user_document', {
  user_document_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  user_document_type_id: smallint()
    .references(() => userDocumentType.user_document_type_id)
    .notNull(),
  document: varchar({ length: 500 }).notNull(),
  document_partial: varchar({ length: 50 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const userDocumentRelations = relations(userDocument, ({ one }) => ({
  udt: one(userDocumentType, {
    fields: [userDocument.user_document_type_id],
    references: [userDocumentType.user_document_type_id],
  }),
}));
