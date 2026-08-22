import 'fastify';

/**
 * Worker-only Fastify augmentation.
 *
 * The application-wide augmentation also exposes PostgreSQL pools and Drizzle
 * databases. Workers deliberately compile against this narrower contract so
 * those database types and drivers never enter their TypeScript program.
 */
declare module 'fastify' {
  export interface FastifyInstance {
    qrStreamReady: boolean;
    baileysInitialized: Promise<void>;
    wwebjsInitialized: Promise<void>;
  }
}
