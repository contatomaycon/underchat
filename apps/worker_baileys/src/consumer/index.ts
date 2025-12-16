import { FastifyInstance } from 'fastify';
import connectionConsume from './connection.consume';
import sendMessageConsume from './sendMessage.consume';
import markMessageReadConsume from './markMessageRead.consume';
import phoneValidationConsume from './phoneValidation.consume';
import notificationMessageSendConsume from './notificationMessageSend.consume';
import scheduleMessageConsume from './scheduleMessage.consume';

export default async function registerConsumers(server: FastifyInstance) {
  await server.register(connectionConsume);
  await server.register(sendMessageConsume);
  await server.register(markMessageReadConsume);
  await server.register(phoneValidationConsume);
  await server.register(notificationMessageSendConsume);
  await server.register(scheduleMessageConsume);
}
