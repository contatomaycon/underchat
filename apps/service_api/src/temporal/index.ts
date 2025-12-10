import { FastifyInstance } from 'fastify';
import { serverSchedule } from './schedule/server.schedule';
import { baileysSchedule } from './schedule/baileys.schedule';
import { profileStatusRenewalSchedule } from './schedule/profileStatusRenewal.schedule';
import { chatbotInactivitySchedule } from './schedule/chatbotInactivity.schedule';
import { workerCreationSchedule } from './schedule/workerCreation.schedule';
import { serverWorker } from './worker/server.worker';
import { baileysWorker } from './worker/baileys.worker';
import { profileStatusRenewalWorker } from './worker/profileStatusRenewal.worker';
import { chatbotInactivityWorker } from './worker/chatbotInactivity.worker';
import { workerCreationWorker } from './worker/workerCreation.worker';

export default async function registerTemporal(server: FastifyInstance) {
  await server.register(serverSchedule);
  await server.register(baileysSchedule);
  await server.register(profileStatusRenewalSchedule);
  await server.register(chatbotInactivitySchedule);
  await server.register(workerCreationSchedule);
  await server.register(serverWorker);
  await server.register(baileysWorker);
  await server.register(profileStatusRenewalWorker);
  await server.register(chatbotInactivityWorker);
  await server.register(workerCreationWorker);
}
