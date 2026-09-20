import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const arch = process.argv[2] ?? process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}.`);

const appPath = process.argv[3] ?? `release/mac-${arch}/Antiphon.app`;
const relativePath = `davey-darwin-${arch}/davey.darwin-${arch}.node`;

const bindingPath = join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules/@snazzah', relativePath);
await access(bindingPath);
const architectures = execFileSync('lipo', ['-archs', bindingPath], { encoding: 'utf8' }).trim().split(/\s+/);
if (!architectures.includes(arch)) {
  throw new Error(`${bindingPath} does not contain the ${arch} architecture.`);
}

console.log(`Verified ${arch} Davey native binding in ${appPath}.`);
