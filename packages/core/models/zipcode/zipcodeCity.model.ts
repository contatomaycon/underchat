import {
  uuid,
  pgTable,
  timestamp,
  varchar,
  numeric,
  smallint,
} from 'drizzle-orm/pg-core';
import { country, zipcode, zipcodeState, zipcodeDistrict } from '@core/models';
import { relations } from 'drizzle-orm';

export const zipcodeCity = pgTable('zipcode_city', {
  id_zipcode_city: uuid().primaryKey().notNull(),
  id_country: smallint()
    .references(() => country.country_id)
    .notNull(),
  id_zipcode_state: uuid()
    .references(() => zipcodeState.id_zipcode_state)
    .notNull(),
  city: varchar({ length: 100 }).notNull(),
  city_area: varchar({ length: 100 }),
  fiscal_code: varchar({ length: 10 }),
  latitude: numeric<'number'>({ precision: 10, scale: 6 }),
  longitude: numeric<'number'>({ precision: 10, scale: 6 }),
  phone_code: varchar({ length: 5 }),
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

export const zipcodeCityRelations = relations(zipcodeCity, ({ one, many }) => ({
  zcc: one(country, {
    fields: [zipcodeCity.id_country],
    references: [country.country_id],
  }),
  zcs: one(zipcodeState, {
    fields: [zipcodeCity.id_zipcode_state],
    references: [zipcodeState.id_zipcode_state],
  }),
  zcd: many(zipcodeDistrict),
  zcp: many(zipcode),
}));
