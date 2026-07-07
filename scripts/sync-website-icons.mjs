#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'website', 'assets', 'icons');
fs.mkdirSync(dest, { recursive: true });
for (const name of ['icon_32.png', 'icon_64.png']) {
  fs.copyFileSync(path.join(root, 'assets', 'icons', name), path.join(dest, name));
}
console.log('[website] Synced icons to website/assets/icons');
