import {
  pgTable,
  timestamp,
  varchar,
  uuid,
  text,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '../account';
import { labelTemplate } from '../label';
import { contactGroupAssignment } from './contactGroupAssignment.model';
import { workerProfileStatusContact } from '../worker/workerProfileStatusContact.model';
import { scheduledContact } from '../schedule';
import { contactDocumentType } from './contactDocumentType.model';
import { user } from '../user/user.model';

export const contact = pgTable(
  'contact',
  {
    contact_id: uuid().primaryKey().notNull(),
    account_id: uuid().references(() => account.account_id),
    label_template_id: uuid().references(() => labelTemplate.label_template_id),
    contact_document_type_id: uuid().references(
      () => contactDocumentType.contact_document_type_id
    ),
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
    document: varchar({ length: 500 }),
    document_partial: varchar({ length: 20 }),
    document_c: varchar({ length: 500 }),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    user_id: uuid().references(() => user.user_id),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('contact_user_id_idx').on(table.user_id),
    index('contact_account_id_idx').on(table.account_id),
    index('contact_label_template_id_idx').on(table.label_template_id),
    index('contact_contact_document_type_id_idx').on(
      table.contact_document_type_id
    ),
    index('contact_email_partial_idx').on(table.email_partial),
    index('contact_phone_partial_idx').on(table.phone_partial),
    index('contact_document_partial_idx').on(table.document_partial),
    index('contact_deleted_at_idx').on(table.deleted_at),
    index('contact_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
    index('contact_account_id_email_c_deleted_at_idx').on(
      table.account_id,
      table.email_c,
      table.deleted_at
    ),
    index('contact_account_id_phone_c_deleted_at_idx').on(
      table.account_id,
      table.phone_c,
      table.deleted_at
    ),
    index('contact_account_id_is_valided_deleted_at_idx').on(
      table.account_id,
      table.is_valided,
      table.deleted_at
    ),
    index('contact_account_id_deleted_at_created_at_idx').on(
      table.account_id,
      table.deleted_at,
      table.created_at
    ),
  ]
);

export const contactRelations = relations(contact, ({ one, many }) => ({
  cac: one(account, {
    fields: [contact.account_id],
    references: [account.account_id],
  }),
  clt: one(labelTemplate, {
    fields: [contact.label_template_id],
    references: [labelTemplate.label_template_id],
  }),
  cdt: one(contactDocumentType, {
    fields: [contact.contact_document_type_id],
    references: [contactDocumentType.contact_document_type_id],
  }),
  cus: one(user, {
    fields: [contact.user_id],
    references: [user.user_id],
  }),
  cga: many(contactGroupAssignment),
  cpc: many(workerProfileStatusContact),
  csc: many(scheduledContact),
}));
