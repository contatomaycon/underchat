import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rootConfig from '../../eslint.config.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));

export default rootConfig.map((config) => {
  const parserOptions = config.languageOptions?.parserOptions;
  if (!parserOptions?.project) {
    return config;
  }

  return {
    ...config,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...parserOptions,
        project: './tsconfig.json',
        tsconfigRootDir: directory,
      },
    },
  };
});
