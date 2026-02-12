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

export function startTemporalSchedules(server: FastifyInstance): void {
  setImmediate(() => {
    const schedules = [
      { name: 'profileStatusRenewal', fn: profileStatusRenewalSchedule },
      { name: 'balanceMonitor', fn: balanceMonitorSchedule },
      { name: 'chatbotInactivity', fn: chatbotInactivitySchedule },
      { name: 'workerCreation', fn: workerCreationSchedule },
      { name: 'planRenewal', fn: planRenewalSchedule },
      { name: 'planExpirationReminder', fn: planExpirationReminderSchedule },
      { name: 'workerMonitor', fn: workerMonitorSchedule },
      { name: 'scheduleSend', fn: scheduleSendSchedule },
    ];

    for (const { name, fn } of schedules) {
      fn(server).catch((err) => {
        server.log.error(err, `Error initializing schedule: ${name}`);
      });
    }
  });
}

export function startTemporalWorkers(server: FastifyInstance): void {
  setImmediate(() => {
    const workers = [
      { name: 'profileStatusRenewal', fn: profileStatusRenewalWorker },
      { name: 'balanceMonitor', fn: balanceMonitorWorker },
      { name: 'chatbotInactivity', fn: chatbotInactivityWorker },
      { name: 'workerCreation', fn: workerCreationWorker },
      { name: 'planRenewal', fn: planRenewalWorker },
      { name: 'planExpirationReminder', fn: planExpirationReminderWorker },
      { name: 'workerMonitor', fn: workerMonitorWorker },
      { name: 'scheduleSend', fn: scheduleSendWorker },
    ];

    for (const { name, fn } of workers) {
      fn(server).catch((err) => {
        server.log.error(err, `Error initializing worker: ${name}`);
      });
    }
  });
}
