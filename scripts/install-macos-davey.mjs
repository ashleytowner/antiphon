import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'));
const version = lockfile.packages['node_modules/@snazzah/davey']?.version;

if (!version) throw new Error('Unable to determine @snazzah/davey version from package-lock.json.');

for (const arch of ['arm64', 'x64']) {
  execFileSync(
    'npm',
    [
      'install',
      '--no-save',
      '--package-lock=false',
      '--ignore-scripts',
      '--os=darwin',
      `--cpu=${arch}`,
      `@snazzah/davey-darwin-${arch}@${version}`,
    ],
    { stdio: 'inherit' },
  );
}
