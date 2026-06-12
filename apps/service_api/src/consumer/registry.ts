import {
  getConsumerOwnerKafkaHealthSnapshot,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

export interface IServiceApiConsumer {
  close?: () => Promise<void>;
  restart?: () => Promise<void>;
}

const consumers: IServiceApiConsumer[] = [];

export function registerServiceApiConsumer(
  consumer: IServiceApiConsumer
): void {
  consumers.push(consumer);
}

export function getServiceApiConsumers(): IServiceApiConsumer[] {
  return [...consumers];
}

export function getServiceApiKafkaHealthSnapshots(): IKafkaConsumerOwnerHealthSnapshot[] {
  return consumers
    .map((consumer) => getConsumerOwnerKafkaHealthSnapshot(consumer))
    .filter(
      (snapshot): snapshot is IKafkaConsumerOwnerHealthSnapshot =>
        snapshot !== null
    );
}

export function hasUnhealthyServiceApiKafkaConsumer(): boolean {
  return getServiceApiKafkaHealthSnapshots().some(
    (snapshot) => snapshot.unhealthy === true
  );
}
