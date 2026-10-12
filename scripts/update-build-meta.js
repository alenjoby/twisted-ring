import fs from 'fs';
import path from 'path';

const buildTimestamp = Date.now();
const isoDate = new Date(buildTimestamp).toISOString();
const versionStr = `2.5.${buildTimestamp}`;

const versionMeta = {
  version: versionStr,
  buildTime: buildTimestamp,
  builtAt: isoDate,
  app: 'Twisted Ring'
};

// 1. Write public/version.json
const versionFilePath = path.resolve('public/version.json');
fs.writeFileSync(versionFilePath, JSON.stringify(versionMeta, null, 2), 'utf-8');
console.log(`Generated public/version.json: ${versionStr}`);

// 2. Update CACHE_VERSION in public/sw.js if sw.js exists
const swPath = path.resolve('public/sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf-8');
  swContent = swContent.replace(/const CACHE_VERSION = ['"][^'"]*['"];/, `const CACHE_VERSION = 'v${buildTimestamp}';`);
  fs.writeFileSync(swPath, swContent, 'utf-8');
  console.log(`Updated public/sw.js with CACHE_VERSION: v${buildTimestamp}`);
}
