import {
  uuid,
  pgTable,
  timestamp,
  varchar,
  numeric,
  smallint,
} from 'drizzle-orm/pg-core';
import { country, zipcodeCity, zipcodeState, zipcode } from '@core/models';
import { relations } from 'drizzle-orm';

export const zipcodeDistrict = pgTable('zipcode_district', {
  id_zipcode_district: uuid().primaryKey().notNull(),
  id_country: smallint()
    .references(() => country.country_id)
    .notNull(),
  id_zipcode_city: uuid()
    .references(() => zipcodeCity.id_zipcode_city)
    .notNull(),
  id_zipcode_state: uuid()
    .references(() => zipcodeState.id_zipcode_state)
    .notNull(),
  district: varchar({ length: 100 }).notNull(),
  latitude: numeric<'number'>({ precision: 10, scale: 6 }),
  longitude: numeric<'number'>({ precision: 10, scale: 6 }),
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

export const zipcodeDistrictRelations = relations(
  zipcodeDistrict,
  ({ one, many }) => ({
    zco: one(country, {
      fields: [zipcodeDistrict.id_country],
      references: [country.country_id],
    }),
    zcc: one(zipcodeCity, {
      fields: [zipcodeDistrict.id_zipcode_city],
      references: [zipcodeCity.id_zipcode_city],
    }),
    zcs: one(zipcodeState, {
      fields: [zipcodeDistrict.id_zipcode_state],
      references: [zipcodeState.id_zipcode_state],
    }),
    zcp: many(zipcode),
  })
);
