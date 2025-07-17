import {
  uuid,
  pgTable,
  timestamp,
  varchar,
  numeric,
  smallint,
} from 'drizzle-orm/pg-core';
import { country, zipcode, zipcodeCity, zipcodeDistrict } from '@core/models';
import { relations } from 'drizzle-orm';

export const zipcodeState = pgTable('zipcode_state', {
  id_zipcode_state: uuid().primaryKey().notNull(),
  id_country: smallint()
    .references(() => country.country_id)
    .notNull(),
  abbreviation: varchar({ length: 3 }),
  capital: varchar({ length: 100 }),
  fiscal_code: varchar({ length: 10 }),
  latitude: numeric<'number'>({ precision: 10, scale: 6 }),
  longitude: numeric<'number'>({ precision: 10, scale: 6 }),
  region: varchar({ length: 100 }),
  state: varchar({ length: 100 }).notNull(),
  zipcode_end: varchar({ length: 15 }),
  zipcode_start: varchar({ length: 15 }),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const zipcodeStateRelations = relations(
  zipcodeState,
  ({ one, many }) => ({
    zco: one(country, {
      fields: [zipcodeState.id_country],
      references: [country.country_id],
    }),
    zcc: many(zipcodeCity),
    zcd: many(zipcodeDistrict),
    zcp: many(zipcode),
  })
);
