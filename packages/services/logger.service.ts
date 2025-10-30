import fastify, { FastifyInstance } from 'fastify';
import { injectable } from 'tsyringe';
import ElasticSearchService from '@core/services/elasticSearch.service';
import { ELogLevel } from '@core/common/enums/ELogLevel';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class LoggerService {
  private logger!: FastifyInstance;

  constructor(private readonly elasticSearchService: ElasticSearchService) {}

  private readonly initializeLogger = async () => {
    const dynamicLogStream =
      await this.elasticSearchService.createDynamicLogStream();

    this.logger = fastify({
      logger: {
        stream: dynamicLogStream,
        redact: {
          paths: this.pathsToRedact(),
          censor: '******',
        },
        level: ELogLevel.info,
      },
    });
  };

  private readonly pathsToRedact = () => {
    return [
      'message.request.body.password',
      'message.response.data.token',
      'message.request.body.payment.credit_card.number',
      'message.request.body.payment.credit_card.expire_month',
      'message.request.body.payment.credit_card.expire_year',
      'message.request.body.payment.credit_card.cvv',
      'message.request.body.payment.credit_card_id',
    ];
  };

  private readonly parseMessage = (message: any, requestId?: string) => {
    return requestId
      ? { requestId, message }
      : { requestId: uuidv4(), message };
  };

  private readonly ensureLoggerInitialized = async () => {
    if (!this.logger) {
      await this.initializeLogger();
    }
  };

  fatal = async (message: any, requestId?: string) => {
    await this.ensureLoggerInitialized();
    const parsedMessage = this.parseMessage(message, requestId);

    this.logger.log.fatal(parsedMessage);
  };

  error = async (message: any, requestId?: string) => {
    await this.ensureLoggerInitialized();
    const parsedMessage = this.parseMessage(message, requestId);

    this.logger.log.error(parsedMessage);
  };

  warn = async (message: any, requestId?: string) => {
    await this.ensureLoggerInitialized();
    const parsedMessage = this.parseMessage(message, requestId);

    this.logger.log.warn(parsedMessage);
  };

  info = async (message: any, requestId?: string) => {
    await this.ensureLoggerInitialized();
    const parsedMessage = this.parseMessage(message, requestId);

    this.logger.log.info(parsedMessage);
  };

  debug = async (message: any, requestId?: string) => {
    await this.ensureLoggerInitialized();
    const parsedMessage = this.parseMessage(message, requestId);

    this.logger.log.debug(parsedMessage);
  };

  trace = async (message: any, requestId?: string) => {
    await this.ensureLoggerInitialized();
    const parsedMessage = this.parseMessage(message, requestId);

    this.logger.log.trace(parsedMessage);
  };
}
