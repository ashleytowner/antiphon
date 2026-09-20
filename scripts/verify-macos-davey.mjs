import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const appPath = process.argv[2] ?? 'release/mac-universal/Antiphon.app';
const bindings = [
  ['x64', 'davey-darwin-x64/davey.darwin-x64.node'],
  ['arm64', 'davey-darwin-arm64/davey.darwin-arm64.node'],
];

for (const [arch, relativePath] of bindings) {
  const bindingPath = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@snazzah', relativePath);
  await access(bindingPath);
  const architectures = execFileSync('lipo', ['-archs', bindingPath], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!architectures.includes(arch)) {
    throw new Error(`${bindingPath} does not contain the ${arch} architecture.`);
  }
}

console.log(`Verified Davey native bindings in ${appPath}.`);
