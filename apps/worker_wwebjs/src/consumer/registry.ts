import {
  getConsumerOwnerKafkaHealthSnapshot,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

export interface IWorkerConsumer {
  close?: () => Promise<void>;
}

const consumers: IWorkerConsumer[] = [];

export function registerWorkerConsumer(consumer: IWorkerConsumer): void {
  consumers.push(consumer);
}

export function getWorkerConsumers(): IWorkerConsumer[] {
  return [...consumers];
}

export function getKafkaConsumerHealthSnapshots(): IKafkaConsumerOwnerHealthSnapshot[] {
  return consumers
    .map((consumer) => getConsumerOwnerKafkaHealthSnapshot(consumer))
    .filter(
      (snapshot): snapshot is IKafkaConsumerOwnerHealthSnapshot =>
        snapshot !== null
    );
}
