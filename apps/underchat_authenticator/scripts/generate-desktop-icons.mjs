import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const appRoot = resolve(import.meta.dirname, '..');
const sourceIcon = resolve(appRoot, '../mobile/assets/icon.png');
const outputDir = resolve(appRoot, 'build/icons');
const pngOutput = resolve(outputDir, 'icon.png');
const icoOutput = resolve(outputDir, 'icon.ico');
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function createIcoBuffer(images) {
  const headerSize = 6;
  const directorySize = images.length * 16;
  let offset = headerSize + directorySize;
  const directoryEntries = [];

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    directoryEntries.push(entry);
    offset += image.buffer.length;
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  return Buffer.concat([
    header,
    ...directoryEntries,
    ...images.map((image) => image.buffer),
  ]);
}

async function buildIconPng(size) {
  const buffer = await sharp(sourceIcon)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();

  return { size, buffer };
}

await mkdir(dirname(pngOutput), { recursive: true });
await sharp(sourceIcon)
  .resize(512, 512, { fit: 'cover' })
  .png()
  .toFile(pngOutput);

const icoImages = [];
for (const size of icoSizes) {
  icoImages.push(await buildIconPng(size));
}

await writeFile(icoOutput, createIcoBuffer(icoImages));

console.log('[underchat_authenticator] desktop icons generated', {
  ico: icoOutput,
  png: pngOutput,
});
