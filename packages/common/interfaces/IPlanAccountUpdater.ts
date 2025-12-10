export interface ICalculatedPlanAccountData {
  recurringPayment: boolean;
  billingPeriodId: string;
  lastPaymentDate: Date;
  nextPaymentDate: Date;
  planValue: string;
}
