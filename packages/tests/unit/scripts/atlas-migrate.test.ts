import fs from 'node:fs';
import path from 'node:path';
import {
  executeAtlasMigration,
  parseAtlasMigrationOptions,
  resolveAtlasMigrationConfiguration,
  type AtlasCommandInvocation,
} from '../../../../scripts/atlas-migrate';

const baseEnvironment = (): NodeJS.ProcessEnv => ({
  ENV: 'prod',
  DB_ATLAS:
    'postgresql://atlas-user:atlas-password@under-atlas-db:5432/dev?sslmode=disable',
  DB_PUBLIC_HOST_RW: 'public-db.internal',
  DB_PUBLIC_PORT_RW: '15432',
  DB_HOST_RW: 'legacy-db.internal',
  DB_PORT_RW: '5432',
  DB_USER: 'application user',
  DB_PASSWORD: 'p@ss:/?# value',
  DB_DATABASE: 'under chat',
  DB_SSLMODE: 'false',
});

describe('Atlas discrete PostgreSQL configuration', () => {
  it('prefers the public RW endpoint and safely encodes shared credentials', () => {
    const configuration = resolveAtlasMigrationConfiguration(baseEnvironment());
    const target = new URL(configuration.targetDatabaseUrl);

    expect(configuration.atlasEnvironment).toBe('prod');
    expect(target.hostname).toBe('public-db.internal');
    expect(target.port).toBe('15432');
    expect(decodeURIComponent(target.username)).toBe('application user');
    expect(decodeURIComponent(target.password)).toBe('p@ss:/?# value');
    expect(decodeURIComponent(target.pathname)).toBe('/under chat');
    expect(target.searchParams.get('search_path')).toBe('public');
    expect(target.searchParams.get('sslmode')).toBe('disable');
  });

  it('uses the direct private PostgreSQL service inside Kubernetes', () => {
    const environment = baseEnvironment();
    environment.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    environment.DB_PRIVATE_DATABASE_URL =
      'postgresql://ignored:ignored@pg-rw.database.svc:5432/ignored?search_path=other';

    const target = new URL(
      resolveAtlasMigrationConfiguration(environment).targetDatabaseUrl
    );

    expect(target.hostname).toBe('pg-rw.database.svc');
    expect(target.port).toBe('5432');
    expect(decodeURIComponent(target.username)).toBe('application user');
    expect(decodeURIComponent(target.password)).toBe('p@ss:/?# value');
    expect(decodeURIComponent(target.pathname)).toBe('/under chat');
    expect(target.searchParams.get('search_path')).toBe('public');
  });

  it('rejects a pooled private migration endpoint inside Kubernetes', () => {
    const environment = baseEnvironment();
    environment.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
    environment.DB_PRIVATE_DATABASE_URL =
      'postgresql://user:password@pg-pooler-rw.database.svc:5432/database';

    expect(() => resolveAtlasMigrationConfiguration(environment)).toThrow(
      'atlas_database_configuration_invalid:DB_PRIVATE_DATABASE_URL'
    );
  });

  it('falls back only to the canonical legacy RW host and port', () => {
    const environment = baseEnvironment();
    delete environment.DB_PUBLIC_HOST_RW;
    delete environment.DB_PUBLIC_PORT_RW;

    const target = new URL(
      resolveAtlasMigrationConfiguration(environment).targetDatabaseUrl
    );

    expect(target.hostname).toBe('legacy-db.internal');
    expect(target.port).toBe('5432');
  });

  it('normalizes supported SSL aliases and rejects invalid modes', () => {
    const required = baseEnvironment();
    required.DB_SSLMODE = 'true';
    expect(
      new URL(
        resolveAtlasMigrationConfiguration(required).targetDatabaseUrl
      ).searchParams.get('sslmode')
    ).toBe('require');

    const invalid = baseEnvironment();
    invalid.DB_SSLMODE = 'sometimes';
    expect(() => resolveAtlasMigrationConfiguration(invalid)).toThrow(
      'atlas_database_configuration_invalid:DB_SSLMODE'
    );
  });

  it.each([
    'ENV',
    'DB_ATLAS',
    'DB_USER',
    'DB_PASSWORD',
    'DB_DATABASE',
    'DB_SSLMODE',
  ])('fails closed when %s is missing', (key) => {
    const environment = baseEnvironment();
    delete environment[key];

    expect(() => resolveAtlasMigrationConfiguration(environment)).toThrow(
      `atlas_database_configuration_missing:${key}`
    );
  });

  it('fails closed when neither public nor legacy endpoint is available', () => {
    const environment = baseEnvironment();
    delete environment.DB_PUBLIC_HOST_RW;
    delete environment.DB_HOST_RW;

    expect(() => resolveAtlasMigrationConfiguration(environment)).toThrow(
      'atlas_database_configuration_missing:DB_PUBLIC_HOST_RW|DB_HOST_RW'
    );
  });

  it('passes the target DSN through an ephemeral child env instead of argv', async () => {
    const environment = baseEnvironment();
    const configuration = resolveAtlasMigrationConfiguration(environment);
    const invocations: AtlasCommandInvocation[] = [];

    await executeAtlasMigration(
      configuration,
      { checkOnly: false, execOrder: 'non-linear' },
      environment,
      async (invocation) => {
        invocations.push(invocation);
      }
    );

    expect(invocations).toHaveLength(2);
    expect(invocations[0]).toMatchObject({
      command: 'atlas',
      stage: 'hash',
      args: ['migrate', 'hash', '--env', 'prod'],
    });
    expect(invocations[1]).toMatchObject({
      command: 'atlas',
      stage: 'apply',
      args: expect.arrayContaining(['--exec-order', 'non-linear']),
    });
    expect(invocations[1]?.args).toEqual([
      'migrate',
      'apply',
      '--exec-order',
      'non-linear',
      '--env',
      'prod',
    ]);
    expect(invocations[1]?.args).not.toContain('--url');
    expect(invocations[1]?.args.join(' ')).not.toContain('p@ss');
    expect(invocations[1]?.args.join(' ')).not.toContain('public-db.internal');
    expect(invocations[0]?.args.join(' ')).not.toContain('atlas-password');
    expect(invocations[0]?.environment.ATLAS_TARGET_DATABASE_URL).toBe(
      configuration.targetDatabaseUrl
    );
    expect(invocations[1]?.environment.ATLAS_TARGET_DATABASE_URL).toBe(
      configuration.targetDatabaseUrl
    );
    expect(environment.ATLAS_TARGET_DATABASE_URL).toBeUndefined();
  });

  it('validates configuration without invoking Atlas in check-only mode', async () => {
    const runner = jest.fn(async () => undefined);
    await executeAtlasMigration(
      resolveAtlasMigrationConfiguration(baseEnvironment()),
      { checkOnly: true },
      baseEnvironment(),
      runner
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it('accepts only the supported command-line options', () => {
    expect(parseAtlasMigrationOptions(['--check'])).toEqual({
      checkOnly: true,
    });
    expect(parseAtlasMigrationOptions(['--exec-order', 'non-linear'])).toEqual({
      checkOnly: false,
      execOrder: 'non-linear',
    });
    expect(() => parseAtlasMigrationOptions(['--url', 'secret'])).toThrow(
      'atlas_migration_argument_invalid'
    );
  });
});

describe('Atlas runtime wiring', () => {
  const root = process.cwd();

  it('routes every target migration script through the discrete wrapper', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    const targetScripts = Object.entries(packageJson.scripts).filter(
      ([name]) =>
        name.startsWith('atlas:run') ||
        name === 'seed:local' ||
        name.startsWith('seed:zipcode:')
    );

    for (const [, command] of targetScripts) {
      expect(command).not.toContain('DB_DATABASE_URL');
    }
    expect(packageJson.scripts['atlas:run']).toBe(
      'tsx scripts/atlas-migrate.ts'
    );
    expect(packageJson.scripts['atlas:run:docker']).toContain(
      'under-atlas ./node_modules/.bin/tsx scripts/atlas-migrate.ts'
    );
  });

  it('wires the Compose-only target host explicitly to under-db', () => {
    const compose = fs.readFileSync(
      path.join(root, 'docker-compose.yml'),
      'utf8'
    );
    const atlasService = compose.slice(compose.indexOf('  under-atlas:'));

    expect(atlasService).toContain('DB_PUBLIC_HOST_RW=under-db');
    expect(atlasService).toContain('DB_PUBLIC_PORT_RW=5432');
  });

  it('makes the Atlas entrypoint fail fast through the discrete check', () => {
    const entrypoint = fs.readFileSync(
      path.join(root, 'infra/atlas/entrypoint.sh'),
      'utf8'
    );

    expect(entrypoint).toContain(
      'ENV=prod ./node_modules/.bin/tsx scripts/atlas-migrate.ts --check'
    );
    expect(entrypoint).not.toContain('DB_DATABASE_URL');
    expect(entrypoint).not.toContain('pulando migrações');
  });

  it('reads the ephemeral target URL from HCL while keeping DB_ATLAS as dev', () => {
    const atlasConfig = fs.readFileSync(path.join(root, 'atlas.hcl'), 'utf8');

    expect(
      atlasConfig.match(/url = getenv\("ATLAS_TARGET_DATABASE_URL"\)/gu)
    ).toHaveLength(3);
    expect(atlasConfig.match(/dev = var\.DB_ATLAS/gu)).toHaveLength(3);
    expect(atlasConfig).toContain('default = getenv("DB_ATLAS")');
  });
});
