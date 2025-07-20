import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';

@injectable()
export class StreamProducerService {
  private readonly streams = new Map<string, KStream>();

  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams
  ) {}

  async send(topic: string, payload: unknown, key?: string): Promise<void> {
    let stream = this.streams.get(topic);

    if (!stream) {
      stream = this.kafkaStreams.getKStream();

      await stream.to(topic);
      await stream.start();

      this.streams.set(topic, stream);
    }

    const data = JSON.stringify(payload);

    if (key === undefined) {
      stream.writeToStream(data);

      return;
    }

    stream.writeToStream({ key, value: data });
  }

  async close(): Promise<boolean[]> {
    return Promise.all([...this.streams.values()].map((s) => s.close()));
  }
}
