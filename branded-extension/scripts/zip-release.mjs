#!/usr/bin/env node
// Zips the built extension into release/<name>-<version>.zip for Chrome Web
// Store upload. Run via `npm run release` (build + zip). Pure Node + system zip.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(pkgDir, 'build');
const releaseDir = path.join(pkgDir, 'release');

if (!existsSync(buildDir)) {
  console.error('build/ not found — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
const slug = pkg.name.replace(/^@[^/]+\//, '').replace(/[^a-z0-9]+/gi, '-');
const zipPath = path.join(releaseDir, `${slug}-${pkg.version}.zip`);

mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', zipPath, '.'], { cwd: buildDir, stdio: 'inherit' });
console.log(`release artifact: ${path.relative(pkgDir, zipPath)}`);
