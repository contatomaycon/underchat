import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contact } from './contact.model';
import { labelTemplate } from '../label';

export const contactLabelTemplate = pgTable(
  'contact_label_template',
  {
    contact_label_template_id: uuid().primaryKey().notNull(),
    contact_id: uuid()
      .references(() => contact.contact_id)
      .notNull(),
    label_template_id: uuid()
      .references(() => labelTemplate.label_template_id)
      .notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('contact_label_template_contact_id_idx').on(table.contact_id),
    index('contact_label_template_label_template_id_idx').on(
      table.label_template_id
    ),
    index('contact_label_template_contact_id_label_template_id_idx').on(
      table.contact_id,
      table.label_template_id
    ),
    uniqueIndex('contact_label_template_contact_label_uidx').on(
      table.contact_id,
      table.label_template_id
    ),
  ]
);

export const contactLabelTemplateRelations = relations(
  contactLabelTemplate,
  ({ one }) => ({
    clt: one(contact, {
      fields: [contactLabelTemplate.contact_id],
      references: [contact.contact_id],
    }),
    ltt: one(labelTemplate, {
      fields: [contactLabelTemplate.label_template_id],
      references: [labelTemplate.label_template_id],
    }),
  })
);
