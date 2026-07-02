#!/usr/bin/env node
/**
 * Regenerate dist/latest.yml from the built Setup exe so checksums match uploads.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const setupName = `Enigma-Setup-${version}.exe`;
const setupPath = join(root, 'dist', setupName);
const ymlPath = join(root, 'dist', 'latest.yml');

if (!existsSync(setupPath)) {
  console.warn(`[latest.yml] Skip — ${setupName} not found`);
  process.exit(0);
}

const data = readFileSync(setupPath);
const sha512 = createHash('sha512').update(data).digest('base64');
const size = data.length;
const releaseDate = new Date().toISOString();

const yml = `version: ${version}
files:
  - url: ${setupName}
    sha512: ${sha512}
    size: ${size}
path: ${setupName}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;

writeFileSync(ymlPath, yml);
console.log(`[latest.yml] Wrote ${ymlPath} (${setupName}, ${size} bytes)`);
