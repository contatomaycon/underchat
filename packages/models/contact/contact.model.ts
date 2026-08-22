import {
  pgTable,
  timestamp,
  varchar,
  uuid,
  text,
  boolean,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { account } from '../account';
import { contactGroupAssignment } from './contactGroupAssignment.model';
import { workerProfileStatusContact } from '../worker/workerProfileStatusContact.model';
import { scheduledContact } from '../schedule';
import { contactDocumentType } from './contactDocumentType.model';
import { contactChannel } from './contactChannel.model';
import { contactLabelTemplate } from './contactLabelTemplate.model';
import { user } from '../user/user.model';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import type { ContactValidationOrigin } from '@core/common/types/ContactValidationOrigin';

export const contact = pgTable(
  'contact',
  {
    contact_id: uuid().primaryKey().notNull(),
    account_id: uuid().references(() => account.account_id),
    contact_document_type_id: uuid().references(
      () => contactDocumentType.contact_document_type_id
    ),
    is_valided: boolean().default(false),
    validation_origin: varchar({ length: 32 }).$type<ContactValidationOrigin>(),
    name: varchar({ length: 250 }).notNull(),
    last_name: varchar({ length: 250 }),
    email: varchar({ length: 500 }),
    email_partial: varchar({ length: 50 }),
    email_c: varchar({ length: 500 }),
    phone_ddi: varchar({ length: 5 }),
    phone: varchar({ length: 500 }),
    phone_partial: varchar({ length: 20 }),
    phone_c: varchar({ length: 500 }),
    nickname: varchar({ length: 250 }),
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
    ignore: varchar({ length: 20 })
      .$type<EContactIgnore>()
      .default(EContactIgnore.not_ignore),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('contact_user_id_idx').on(table.user_id),
    index('contact_account_id_idx').on(table.account_id),
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
    check(
      'contact_validation_origin_check',
      sql`${table.validation_origin} IS NULL OR (${table.is_valided} IS TRUE AND ${table.validation_origin} IN ('whatsapp_lookup', 'official_assumed', 'official_inbound'))`
    ),
  ]
);

export const contactRelations = relations(contact, ({ one, many }) => ({
  cac: one(account, {
    fields: [contact.account_id],
    references: [account.account_id],
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
  cch: many(contactChannel),
  clt: many(contactLabelTemplate),
  cpc: many(workerProfileStatusContact),
  csc: many(scheduledContact),
}));
