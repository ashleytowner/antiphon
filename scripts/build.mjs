import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/renderer', { recursive: true });
await mkdir('dist/player', { recursive: true });
await build({ entryPoints: ['src/main/main.ts', 'src/main/preload.ts'], outdir: 'dist/main', bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'werift'], sourcemap: true });
await build({ entryPoints: ['src/renderer/app.tsx'], outdir: 'dist/renderer', bundle: true, platform: 'browser', sourcemap: true });
await copyFile('src/renderer/index.html', 'dist/renderer/index.html');
