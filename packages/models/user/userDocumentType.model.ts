import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { userDocument } from '@core/models';

export const userDocumentType = pgTable(
  'user_document_type',
  {
    user_document_type_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 20 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('user_document_type_name_idx').on(table.name)]
);

export const userDocumentTypeRelations = relations(
  userDocumentType,
  ({ one }) => ({
    uud: one(userDocument, {
      fields: [userDocumentType.user_document_type_id],
      references: [userDocument.user_document_type_id],
    }),
  })
);
