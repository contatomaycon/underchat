import { FastifyInstance } from 'fastify';
import balanceConsume from './balance.consume';
import workerConsume from './worker.consume';
import messageUpdateConsume from './updateMessage.consume';
import messageUpsertMessage from './upsertMessage.consume';
import messageStatusUpdateConsume from './updateMessageStatus.consume';
import clearChatSummaryConsume from './clearChatSummary.consume';
import phoneValidationResponseConsume from './phoneValidationResponse.consume';

export default async function registerConsumer(server: FastifyInstance) {
  await server.register(balanceConsume);
  await server.register(workerConsume);
  await server.register(messageUpdateConsume);
  await server.register(messageUpsertMessage);
  await server.register(messageStatusUpdateConsume);
  await server.register(clearChatSummaryConsume);
  await server.register(phoneValidationResponseConsume);
}
