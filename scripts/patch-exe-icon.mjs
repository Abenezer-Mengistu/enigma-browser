/**
 * Post-build fallback: brand unpacked exe and dev electron.exe.
 */
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { applyWindowsBranding } from './win-exe-branding.mjs';

const root = resolve(import.meta.dirname, '..');

const targets = [
  join(root, 'dist', 'win-unpacked', 'Enigma.exe'),
  join(root, 'dist2', 'win-unpacked', 'Enigma.exe'),
  join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
];

for (const exe of targets) {
  if (!existsSync(exe)) continue;
  try {
    await applyWindowsBranding(exe);
    console.log('Branding set:', exe.replace(root + '\\', ''));
  } catch (e) {
    console.warn('Skip (file locked?):', exe.replace(root + '\\', ''));
  }
}
