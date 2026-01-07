import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contactGroup, contact } from '../contact';
import { schedule } from './schedule.model';

export const scheduledContact = pgTable(
  'scheduled_contact',
  {
    scheduled_contact_id: uuid().primaryKey().notNull(),
    schedule_id: uuid()
      .references(() => schedule.schedule_id)
      .notNull(),
    contact_group_id: uuid().references(() => contactGroup.contact_group_id),
    contact_id: uuid().references(() => contact.contact_id),
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
    index('scheduled_contact_schedule_id_idx').on(table.schedule_id),
    index('scheduled_contact_contact_group_id_idx').on(table.contact_group_id),
    index('scheduled_contact_contact_id_idx').on(table.contact_id),
  ]
);

export const scheduledContactRelations = relations(
  scheduledContact,
  ({ one }) => ({
    scs: one(schedule, {
      fields: [scheduledContact.schedule_id],
      references: [schedule.schedule_id],
    }),
    scc: one(contactGroup, {
      fields: [scheduledContact.contact_group_id],
      references: [contactGroup.contact_group_id],
    }),
    sco: one(contact, {
      fields: [scheduledContact.contact_id],
      references: [contact.contact_id],
    }),
  })
);
