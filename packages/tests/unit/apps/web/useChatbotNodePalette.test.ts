import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type Position = { x: number; y: number };
type Preferences = {
  version: 1;
  minimized: boolean;
  position: Position;
};
type Bounds = {
  containerWidth: number;
  containerHeight: number;
  panelWidth: number;
  panelHeight: number;
  margin?: number;
};

type PaletteModule = {
  normalizeChatbotNodePalettePosition: (
    value: unknown,
    fallback?: Position
  ) => Position;
  normalizeChatbotNodePalettePreferences: (
    value: unknown
  ) => Preferences | null;
  clampChatbotNodePalettePosition: (
    position: Position,
    bounds: Bounds
  ) => Position;
};

const loadPaletteModule = (): PaletteModule => {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/composables/useChatbotNodePalette.ts'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  const moduleRequire = (moduleId: string): unknown => {
    const modules: Record<string, unknown> = {
      '@vueuse/core': { useStorage: jest.fn() },
      vue: { computed: jest.fn(), readonly: jest.fn() },
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected palette dependency: ${moduleId}`);
    }

    return modules[moduleId];
  };
  const evaluateModule = new Function(
    'require',
    'module',
    'exports',
    transpiled
  ) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loadedModule,
    exports: Record<string, unknown>
  ) => void;
  evaluateModule(moduleRequire, loadedModule, loadedModule.exports);

  return loadedModule.exports as unknown as PaletteModule;
};

const {
  normalizeChatbotNodePalettePosition,
  normalizeChatbotNodePalettePreferences,
  clampChatbotNodePalettePosition,
} = loadPaletteModule();

describe('chatbot node palette preferences', () => {
  it('accepts only the current, finite persisted preference shape', () => {
    const persisted = {
      version: 1,
      minimized: true,
      position: { x: 96, y: 144 },
    };

    const normalized = normalizeChatbotNodePalettePreferences(persisted);

    expect(normalized).toEqual(persisted);
    expect(normalized).not.toBe(persisted);
    expect(normalized?.position).not.toBe(persisted.position);
    expect(
      normalizeChatbotNodePalettePreferences({
        ...persisted,
        version: 2,
      })
    ).toBeNull();
    expect(
      normalizeChatbotNodePalettePreferences({
        ...persisted,
        position: { x: Number.NaN, y: 144 },
      })
    ).toBeNull();
  });

  it('falls back from malformed positions without exposing the fallback object', () => {
    const fallback = { x: 32, y: 48 };
    const normalized = normalizeChatbotNodePalettePosition(
      { x: '32', y: null },
      fallback
    );

    expect(normalized).toEqual(fallback);
    expect(normalized).not.toBe(fallback);
  });

  it('clamps a palette position to its visible canvas bounds', () => {
    expect(
      clampChatbotNodePalettePosition(
        { x: -30, y: 999 },
        {
          containerWidth: 1000,
          containerHeight: 700,
          panelWidth: 400,
          panelHeight: 300,
          margin: 12,
        }
      )
    ).toEqual({ x: 12, y: 388 });
  });

  it('pins oversized palettes to the available origin', () => {
    expect(
      clampChatbotNodePalettePosition(
        { x: 24, y: 24 },
        {
          containerWidth: 300,
          containerHeight: 200,
          panelWidth: 400,
          panelHeight: 260,
        }
      )
    ).toEqual({ x: 0, y: 0 });
  });
});
