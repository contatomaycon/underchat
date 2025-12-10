import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workerProfileStatus } from './workerProfileStatus.model';
import { contact } from '../contact/contact.model';

export const workerProfileStatusContact = pgTable(
  'worker_profile_status_contact',
  {
    worker_profile_status_contact_id: uuid().primaryKey().notNull(),
    worker_profile_status_id: uuid()
      .references(() => workerProfileStatus.worker_profile_status_id)
      .notNull(),
    contact_id: uuid()
      .references(() => contact.contact_id)
      .notNull(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  }
);

export const workerProfileStatusContactRelations = relations(
  workerProfileStatusContact,
  ({ one }) => ({
    wsc: one(workerProfileStatus, {
      fields: [workerProfileStatusContact.worker_profile_status_id],
      references: [workerProfileStatus.worker_profile_status_id],
    }),
    wst: one(contact, {
      fields: [workerProfileStatusContact.contact_id],
      references: [contact.contact_id],
    }),
  })
);
