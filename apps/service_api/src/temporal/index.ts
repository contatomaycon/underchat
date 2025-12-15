import { FastifyInstance } from 'fastify';
import { profileStatusRenewalSchedule } from './schedule/profileStatusRenewal.schedule';
import { balanceMonitorSchedule } from './schedule/balanceMonitor.schedule';
import { chatbotInactivitySchedule } from './schedule/chatbotInactivity.schedule';
import { workerCreationSchedule } from './schedule/workerCreation.schedule';
import { planRenewalSchedule } from './schedule/planRenewal.schedule';
import { planExpirationReminderSchedule } from './schedule/planExpirationReminder.schedule';
import { workerMonitorSchedule } from './schedule/workerMonitor.schedule';
import { scheduleSendSchedule } from './schedule/scheduleSend.schedule';
import { profileStatusRenewalWorker } from './worker/profileStatusRenewal.worker';
import { balanceMonitorWorker } from './worker/balanceMonitor.worker';
import { chatbotInactivityWorker } from './worker/chatbotInactivity.worker';
import { workerCreationWorker } from './worker/workerCreation.worker';
import { planRenewalWorker } from './worker/planRenewal.worker';
import { planExpirationReminderWorker } from './worker/planExpirationReminder.worker';
import { workerMonitorWorker } from './worker/workerMonitor.worker';
import { scheduleSendWorker } from './worker/scheduleSend.worker';

export default async function registerTemporal(server: FastifyInstance) {
  await server.register(profileStatusRenewalSchedule);
  await server.register(balanceMonitorSchedule);
  await server.register(chatbotInactivitySchedule);
  await server.register(workerCreationSchedule);
  await server.register(planRenewalSchedule);
  await server.register(planExpirationReminderSchedule);
  await server.register(workerMonitorSchedule);
  await server.register(scheduleSendSchedule);
  await server.register(profileStatusRenewalWorker);
  await server.register(balanceMonitorWorker);
  await server.register(chatbotInactivityWorker);
  await server.register(workerCreationWorker);
  await server.register(planRenewalWorker);
  await server.register(planExpirationReminderWorker);
  await server.register(workerMonitorWorker);
  await server.register(scheduleSendWorker);
}
