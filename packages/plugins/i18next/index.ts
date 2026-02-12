import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { plugin, LanguageDetector } from 'i18next-http-middleware';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLanguageFromHeader } from '@core/common/functions/getLanguageFromHeader';
import { createLanguageData } from '@core/common/functions/createLanguageData';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function i18nextPlugin(fastify: FastifyInstance) {
  const localesPath = path.join(
    __dirname,
    'locales',
    '{{lng}}',
    'translation.json'
  );

  i18next
    .use(Backend)
    .use(LanguageDetector)
    .init({
      fallbackLng: 'pt',
      showSupportNotice: false,
      backend: {
        loadPath: localesPath,
      },
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
      returnEmptyString: false,
      returnObjects: false,
    });

  await fastify.register(plugin, {
    i18next,
  });

  fastify.decorate('i18n', i18next.t);

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const acceptLanguage = request.headers['accept-language'];
    const language = getLanguageFromHeader(acceptLanguage);

    request.languageData = createLanguageData(language);
  });
}

export default fp(i18nextPlugin);
