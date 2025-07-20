import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { IKafkaMsg } from '@core/common/interfaces/IKafkaMsg';

@injectable()
export class StreamConsumerService {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams
  ) {}

  async listen(topic: string): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(topic);

    stream.mapBufferKeyToString();
    stream.mapBufferValueToString();

    stream.forEach((msg: IKafkaMsg) => {
      console.dir(msg, { depth: null });

      if (!msg.value) return;

      let raw = String(msg.value);
      if (msg.value instanceof Buffer) {
        raw = msg.value.toString('utf8');
      }

      const content = JSON.parse(raw);

      console.log('📨 received ->', content);
    });

    await stream.start();
  }
}
