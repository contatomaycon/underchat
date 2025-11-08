import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contact } from './contact.model';
import { contactGroup } from './contactGroup.model';

export const contactGroupAssignment = pgTable('contact_group_assignment', {
  contact_group_assignment_id: uuid().primaryKey().notNull(),
  contact_id: uuid()
    .references(() => contact.contact_id)
    .notNull(),
  contact_group_id: uuid()
    .references(() => contactGroup.contact_group_id)
    .notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const contactGroupAssignmentRelations = relations(
  contactGroupAssignment,
  ({ one }) => ({
    cga: one(contact, {
      fields: [contactGroupAssignment.contact_id],
      references: [contact.contact_id],
    }),
    cgg: one(contactGroup, {
      fields: [contactGroupAssignment.contact_group_id],
      references: [contactGroup.contact_group_id],
    }),
  })
);
