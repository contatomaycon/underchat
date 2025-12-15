import {
  pgTable,
  timestamp,
  varchar,
  uuid,
  text,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '../account';
import { labelTemplate } from '../label';
import { contactGroupAssignment } from './contactGroupAssignment.model';
import { workerProfileStatusContact } from '../worker/workerProfileStatusContact.model';
import { scheduledContact } from '../schedule';

export const contact = pgTable('contact', {
  contact_id: uuid().primaryKey().notNull(),
  account_id: uuid().references(() => account.account_id),
  label_template_id: uuid().references(() => labelTemplate.label_template_id),
  is_valided: boolean().default(false),
  name: varchar({ length: 100 }).notNull(),
  last_name: varchar({ length: 100 }),
  email: varchar({ length: 500 }),
  email_partial: varchar({ length: 50 }),
  email_c: varchar({ length: 500 }),
  phone_ddi: varchar({ length: 5 }),
  phone: varchar({ length: 500 }),
  phone_partial: varchar({ length: 15 }),
  phone_c: varchar({ length: 500 }),
  nickname: varchar({ length: 100 }),
  photo: varchar({ length: 500 }),
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
  cpc: many(workerProfileStatusContact),
  csc: many(scheduledContact),
}));
