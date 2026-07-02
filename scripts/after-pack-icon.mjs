/**
 * Embed Enigma icon + Windows version metadata BEFORE NSIS/portable run.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { applyWindowsBranding } from './win-exe-branding.mjs';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exe = join(context.appOutDir, exeName);
  if (!existsSync(exe)) {
    console.warn('[afterPack] executable not found:', exeName);
    return;
  }

  const version = context.packager.appInfo.version;
  await applyWindowsBranding(exe, version);
  console.log('[afterPack] Enigma branding applied to', exeName, `(v${version})`);
}
