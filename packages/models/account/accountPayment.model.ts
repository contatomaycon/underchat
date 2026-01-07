import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  account,
  userCustomer,
  plan,
  userCard,
  paymentBillingType,
  paymentStatus,
  billingPeriod,
  accountPaymentCrossSell,
  accountPaymentNfSe,
} from '@core/models';

export const accountPayment = pgTable(
  'account_payment',
  {
    account_payment_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    user_customer_id: uuid()
      .references(() => userCustomer.user_customer_id)
      .notNull(),
    plan_id: uuid()
      .references(() => plan.plan_id)
      .notNull(),
    billing: varchar({ length: 500 }).notNull(),
    payment_billing_type_id: uuid()
      .references(() => paymentBillingType.payment_billing_type_id)
      .notNull(),
    value: numeric({ precision: 10, scale: 2 }).notNull(),
    net_value: numeric({ precision: 10, scale: 2 }).notNull(),
    user_card_id: uuid().references(() => userCard.user_card_id),
    installment: numeric({ precision: 10, scale: 2 }),
    boleto: varchar({ length: 500 }),
    boleto_number: varchar({ length: 100 }),
    boleto_pdf: varchar({ length: 500 }),
    pix_transaction: varchar({ length: 500 }),
    payment_status_id: uuid()
      .references(() => paymentStatus.payment_status_id)
      .notNull(),
    payment_date: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    billing_period_id: uuid().references(() => billingPeriod.billing_period_id),
    invoice_url: varchar({ length: 1000 }),
    recurring_payment: boolean().notNull().default(false),
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
    index('account_payment_account_id_idx').on(table.account_id),
    index('account_payment_user_customer_id_idx').on(table.user_customer_id),
    index('account_payment_plan_id_idx').on(table.plan_id),
    index('account_payment_payment_billing_type_id_idx').on(
      table.payment_billing_type_id
    ),
    index('account_payment_payment_status_id_idx').on(table.payment_status_id),
    index('account_payment_payment_date_idx').on(table.payment_date),
  ]
);

export const accountPaymentRelations = relations(
  accountPayment,
  ({ one, many }) => ({
    apa: one(account, {
      fields: [accountPayment.account_id],
      references: [account.account_id],
    }),
    auc: one(userCustomer, {
      fields: [accountPayment.user_customer_id],
      references: [userCustomer.user_customer_id],
    }),
    apl: one(plan, {
      fields: [accountPayment.plan_id],
      references: [plan.plan_id],
    }),
    apd: one(userCard, {
      fields: [accountPayment.user_card_id],
      references: [userCard.user_card_id],
    }),
    apb: one(paymentBillingType, {
      fields: [accountPayment.payment_billing_type_id],
      references: [paymentBillingType.payment_billing_type_id],
    }),
    aps: one(paymentStatus, {
      fields: [accountPayment.payment_status_id],
      references: [paymentStatus.payment_status_id],
    }),
    app: one(billingPeriod, {
      fields: [accountPayment.billing_period_id],
      references: [billingPeriod.billing_period_id],
    }),
    apc: many(accountPaymentCrossSell),
    apn: many(accountPaymentNfSe),
  })
);
