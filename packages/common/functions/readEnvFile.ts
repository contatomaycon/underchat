import { promises as fs } from 'fs';

export async function readEnvFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');

    if (!content) {
      throw new Error(`File ${filePath} is empty`);
    }

    const escapedEnvContent = content
      .split('\n')
      .map((line) => line.replace(/(["`\\$])/g, '\\$1'))
      .join('\\n');

    return escapedEnvContent;
  } catch (err) {
    console.error(`Erro ao ler o arquivo ${filePath}:`, err);
    throw err;
  }
}
