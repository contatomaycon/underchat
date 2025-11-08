import { pgTable, timestamp, varchar, uuid, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '../account';
import { labelTemplate } from '../label';
import { contactGroupAssignment } from './contactGroupAssignment.model';

export const contact = pgTable('contact', {
  contact_id: uuid().primaryKey().notNull(),
  account_id: uuid().references(() => account.account_id),
  label_template_id: uuid().references(() => labelTemplate.label_template_id),
  name: varchar({ length: 100 }).notNull(),
  last_name: varchar({ length: 100 }),
  email: varchar({ length: 500 }),
  email_partial: varchar({ length: 25 }),
  phone_ddi: varchar({ length: 5 }),
  phone: varchar({ length: 500 }),
  phone_partial: varchar({ length: 15 }),
  nickname: varchar({ length: 100 }),
  birthday: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  notes: text(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp({ mode: 'string', withTimezone: true }),
});

export const contactRelations = relations(contact, ({ one, many }) => ({
  cac: one(account, {
    fields: [contact.account_id],
    references: [account.account_id],
  }),
  clt: one(labelTemplate, {
    fields: [contact.label_template_id],
    references: [labelTemplate.label_template_id],
  }),
  cga: many(contactGroupAssignment),
}));
