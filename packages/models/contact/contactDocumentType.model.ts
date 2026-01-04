import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contact } from './contact.model';

export const contactDocumentType = pgTable('contact_document_type', {
  contact_document_type_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 20 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const contactDocumentTypeRelations = relations(
  contactDocumentType,
  ({ many }) => ({
    contacts: many(contact),
  })
);
