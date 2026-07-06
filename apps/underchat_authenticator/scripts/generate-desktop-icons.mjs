import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const appRoot = resolve(import.meta.dirname, '..');
const sourceIcon = resolve(appRoot, '../mobile/assets/icon.png');
const outputDir = resolve(appRoot, 'build/icons');
const pngOutput = resolve(outputDir, 'icon.png');
const icoOutput = resolve(outputDir, 'icon.ico');
const icnsOutput = resolve(outputDir, 'icon.icns');
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsSizes = [
  { size: 16, type: 'icp4' },
  { size: 32, type: 'icp5' },
  { size: 64, type: 'icp6' },
  { size: 128, type: 'ic07' },
  { size: 256, type: 'ic08' },
  { size: 512, type: 'ic09' },
  { size: 1024, type: 'ic10' },
];

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

function createIcnsBuffer(images) {
  const entries = images.map((image) => {
    const entryHeader = Buffer.alloc(8);
    entryHeader.write(image.type, 0, 4, 'ascii');
    entryHeader.writeUInt32BE(image.buffer.length + entryHeader.length, 4);

    return Buffer.concat([entryHeader, image.buffer]);
  });
  const totalLength = 8 + entries.reduce((sum, entry) => sum + entry.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);

  return Buffer.concat([header, ...entries]);
}

async function buildIconPng(size) {
  const buffer = await sharp(sourceIcon)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();

  return { size, buffer };
}

async function buildIcnsImage({ size, type }) {
  const buffer = await sharp(sourceIcon)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();

  return { buffer, type };
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

const icnsImages = [];
for (const icon of icnsSizes) {
  icnsImages.push(await buildIcnsImage(icon));
}

await writeFile(icoOutput, createIcoBuffer(icoImages));
await writeFile(icnsOutput, createIcnsBuffer(icnsImages));

console.log('[underchat_authenticator] desktop icons generated', {
  icns: icnsOutput,
  ico: icoOutput,
  png: pngOutput,
});
