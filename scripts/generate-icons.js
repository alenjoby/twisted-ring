import fs from 'fs';
import path from 'path';
import { deflateSync } from 'fflate';

function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const crcTable = createCRC32Table();
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const typeAndData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function generatePngBuffer(width, height, drawFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // deflate
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // no interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw scanlines: 1 filter byte (0) + width * 4 bytes per row
  const rowStride = 1 + width * 4;
  const rawData = Buffer.alloc(rowStride * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawData[rowOffset] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawFn(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const deflated = deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', Buffer.from(deflated));
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Icon Drawer: Cyber Gold Tactical Arena Ring with Crosshairs & Glowing Center
function drawTacticalIcon(x, y, w, h, isMaskable = false) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);

  // Background: Deep tactical gradient #090c13 to #141926
  const normDistToCorner = dist / (w * 0.7);
  let bgR = Math.round(9 + normDistToCorner * 12);
  let bgG = Math.round(12 + normDistToCorner * 14);
  let bgB = Math.round(19 + normDistToCorner * 22);

  // Maskable icons fill entire square, standard icons have rounded corners
  let cornerAlpha = 255;
  if (!isMaskable) {
    const cornerRadius = w * 0.22;
    const clampedX = Math.max(cornerRadius, Math.min(w - cornerRadius, x));
    const clampedY = Math.max(cornerRadius, Math.min(h - cornerRadius, y));
    const cDist = Math.hypot(x - clampedX, y - clampedY);
    if (cDist > cornerRadius) {
      cornerAlpha = Math.max(0, Math.min(255, Math.round((cornerRadius + 1 - cDist) * 255)));
    }
  }

  if (cornerAlpha === 0) return [0, 0, 0, 0];

  // Outer Golden Ring: radius ~0.36 * w
  const ringR = w * 0.35;
  const ringThickness = w * 0.055;
  const ringDist = Math.abs(dist - ringR);

  // Inner Core Glowing Ring: radius ~0.16 * w
  const innerR = w * 0.16;
  const innerThickness = w * 0.035;
  const innerDist = Math.abs(dist - innerR);

  // Crosshairs: 4 ticks along horizontal and vertical axes
  const onAxisX = Math.abs(dy) <= (w * 0.02) && (dist >= innerR * 0.8 && dist <= ringR * 1.25);
  const onAxisY = Math.abs(dx) <= (w * 0.02) && (dist >= innerR * 0.8 && dist <= ringR * 1.25);

  let r = bgR;
  let g = bgG;
  let b = bgB;

  // Render Outer Gold Ring with subtle glow
  if (ringDist <= ringThickness) {
    const intensity = 1 - (ringDist / ringThickness);
    // Gold: #ffcc00
    r = Math.round(r * (1 - intensity) + 255 * intensity);
    g = Math.round(g * (1 - intensity) + 204 * intensity);
    b = Math.round(b * (1 - intensity) + 0 * intensity);
  } else if (ringDist <= ringThickness * 2.2) {
    const glow = (1 - (ringDist - ringThickness) / (ringThickness * 1.2)) * 0.45;
    r = Math.min(255, Math.round(r + 255 * glow));
    g = Math.min(255, Math.round(g + 180 * glow));
    b = Math.min(255, Math.round(b + 30 * glow));
  }

  // Render Inner Core Ring (Cyan / White laser core #00f0ff)
  if (innerDist <= innerThickness) {
    const intensity = 1 - (innerDist / innerThickness);
    r = Math.round(r * (1 - intensity) + 255 * intensity);
    g = Math.round(g * (1 - intensity) + 255 * intensity);
    b = Math.round(b * (1 - intensity) + 255 * intensity);
  } else if (dist < innerR) {
    // Glowing center diamond / dot
    const centerGlow = Math.max(0, 1 - dist / (innerR * 0.8));
    r = Math.min(255, Math.round(r + 255 * centerGlow * 0.9));
    g = Math.min(255, Math.round(g + 42 * centerGlow * 0.9)); // Crimson laser accent
    b = Math.min(255, Math.round(b + 95 * centerGlow * 0.9));
  }

  // Render crosshairs
  if (onAxisX || onAxisY) {
    r = Math.min(255, r + 180);
    g = Math.min(255, g + 160);
    b = Math.min(255, b + 120);
  }

  return [r, g, b, cornerAlpha];
}

const iconsDir = path.resolve('public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('Generating 192x192 icon...');
const icon192 = generatePngBuffer(192, 192, (x, y, w, h) => drawTacticalIcon(x, y, w, h, false));
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), icon192);

console.log('Generating 512x512 icon...');
const icon512 = generatePngBuffer(512, 512, (x, y, w, h) => drawTacticalIcon(x, y, w, h, false));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), icon512);

console.log('Generating 512x512 maskable icon...');
const iconMaskable = generatePngBuffer(512, 512, (x, y, w, h) => drawTacticalIcon(x, y, w, h, true));
fs.writeFileSync(path.join(iconsDir, 'icon-maskable.png'), iconMaskable);

console.log('Generating SVG icon...');
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bgGrad" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#141926" />
      <stop offset="100%" stop-color="#090c13" />
    </radialGradient>
    <radialGradient id="goldGlow" cx="50%" cy="50%" r="50%">
      <stop offset="70%" stop-color="#ffcc00" stop-opacity="1" />
      <stop offset="100%" stop-color="#ff9900" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="laserBeam" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff2a5f" />
      <stop offset="100%" stop-color="#ffcc00" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)" />
  <circle cx="256" cy="256" r="180" fill="none" stroke="#ffcc00" stroke-width="26" opacity="0.9" />
  <circle cx="256" cy="256" r="180" fill="none" stroke="#ffe680" stroke-width="12" />
  <circle cx="256" cy="256" r="82" fill="none" stroke="#ffffff" stroke-width="14" opacity="0.9" />
  <circle cx="256" cy="256" r="32" fill="#ff2a5f" />
  <circle cx="256" cy="256" r="16" fill="#ffffff" />
  <line x1="256" y1="56" x2="256" y2="456" stroke="rgba(255,255,255,0.4)" stroke-width="8" stroke-dasharray="24 16" />
  <line x1="56" y1="256" x2="456" y2="256" stroke="rgba(255,255,255,0.4)" stroke-width="8" stroke-dasharray="24 16" />
  <circle cx="256" cy="256" r="12" fill="#ffffff" />
</svg>`;
fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgContent, 'utf-8');

console.log('All icons generated successfully!');
