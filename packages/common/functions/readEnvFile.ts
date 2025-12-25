import { promises as fs } from 'node:fs';

function generateEnvFromProcessEnv(): string {
  const envLines: string[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }

    envLines.push(`${key}=${value}`);
  }

  return envLines.join('\n');
}

export async function readEnvFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');

    if (!content) {
      throw new Error(`File ${filePath} is empty`);
    }

    const escapedEnvContent = content
      .split('\n')
      .map((line) => line.replaceAll(/(["`\\$])/g, String.raw`\$1`))
      .join(String.raw`\n`);

    return escapedEnvContent;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;

    if (error.code === 'ENOENT') {
      const envContent = generateEnvFromProcessEnv();
      return envContent
        .split('\n')
        .map((line) => line.replaceAll(/(["`\\$])/g, String.raw`\$1`))
        .join(String.raw`\n`);
    }

    console.error(`Erro ao ler o arquivo ${filePath}:`, err);
    throw err;
  }
}
