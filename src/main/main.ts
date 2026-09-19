import { app, BrowserWindow, dialog, ipcMain, protocol, powerSaveBlocker } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { Library } from './library';
import { loadSettings, storeSettings, defaults, validateSettings } from './settings';
import { audioResponse } from './audio-response';
import { PlayerServer, validateOffer } from './server';
import type { ScanProgress, Settings } from '../shared/types';

protocol.registerSchemesAsPrivileged([{ scheme: 'rpg-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
if (process.env.RPG_USER_DATA) app.setPath('userData', process.env.RPG_USER_DATA);
let server: PlayerServer | undefined;
let worker: Worker | undefined;
let library: Library;
let settings: Settings;
let serverError: string | undefined;
let quitting = false;
let saving = false;
let broadcasting = false;
let blocker: number | undefined;

app.whenReady().then(async () => {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = await loadSettings(settingsFile); }
  catch (error) { dialog.showErrorBox('Unable to load settings', String(error)); settings = { ...defaults }; }
  if (!settings.libraryRoot) {
    const nearby = path.resolve(app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(), '../RPG Music & Ambience');
    if (existsSync(nearby)) settings.libraryRoot = nearby;
  }
  const database = path.join(app.getPath('userData'), 'library.sqlite');
  library = new Library(database);
  const startServer = async () => {
    const next = new PlayerServer(settings, path.join(__dirname, '../player'));
    try { await next.start(); server = next; serverError = undefined; }
    catch (error) { await next.close(); server = undefined; serverError = String((error as Error).message); }
  };
  await startServer();
  protocol.handle('rpg-audio', request => {
    const url = new URL(request.url);
    const id = /^\/([1-9]\d*)$/.exec(url.pathname)?.[1];
    return audioResponse(url.hostname === 'track' && id ? library.file(settings.libraryRoot, Number(id)) : undefined, request);
  });
  const window = new BrowserWindow({
    width: 1400, height: 950, minWidth: 1000, minHeight: 650,
    backgroundColor: '#11151e', title: 'Antiphon',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const handle = (channel: string, callback: (...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted application frame.');
    return callback(...args);
  });
  handle('settings:get', () => settings);
  handle('settings:save', async (value: Settings) => {
    if (worker || saving || broadcasting) throw new Error('Wait for indexing or connection setup to finish before changing settings.');
    saving = true;
    try {
      const next = validateSettings(value);
      await storeSettings(settingsFile, next);
      settings = next;
      await server?.close(); server = undefined;
      if (blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
      await startServer();
      if (serverError) throw new Error(`Settings saved, but the server could not start: ${serverError}`);
    } finally { saving = false; }
  });
  handle('library:choose', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], defaultPath: settings.libraryRoot || app.getPath('music') });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('library:query', query => library.query(settings.libraryRoot, query ?? {}));
  handle('library:facets', () => library.facets(settings.libraryRoot));
  handle('library:edit', (id, value) => library.edit(settings.libraryRoot, id, value));
  handle('library:scan', () => {
    if (worker || saving) throw new Error('An index or settings update is already in progress.');
    if (!settings.libraryRoot) throw new Error('Choose your audio library in Settings first.');
    let completed = false;
    worker = new Worker(path.join(__dirname, 'scan-worker.js'), { workerData: { root: settings.libraryRoot, database } });
    const notify = (progress: ScanProgress) => { if (!window.isDestroyed()) window.webContents.send('library:progress', progress); };
    worker.on('message', (progress: ScanProgress) => { if (progress.phase === 'done' || progress.phase === 'error') completed = true; notify(progress); });
    worker.on('error', error => { completed = true; notify({ phase: 'error', count: 0, message: error.message }); });
    worker.on('exit', () => { worker = undefined; if (!completed) notify({ phase: 'error', count: 0, message: 'Indexer stopped unexpectedly. Please re-index.' }); });
  });
  handle('server:status', () => server?.status() ?? { running: false, broadcasting: false, listeners: 0, urls: [], error: serverError });
  handle('broadcast:start', async offer => {
    if (!server || saving) throw new Error(serverError ?? 'Server is not ready.');
    if (broadcasting) throw new Error('Broadcast connection is already being prepared.');
    broadcasting = true;
    try {
      const answer = await server.relay.publish(validateOffer(offer));
      blocker ??= powerSaveBlocker.start('prevent-app-suspension');
      return answer;
    } finally { broadcasting = false; }
  });
  handle('broadcast:stop', async () => {
    await server?.relay.stopPublisher();
    if (blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
  });
  window.webContents.on('render-process-gone', () => { void server?.relay.stopPublisher(); });
  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
}).catch(error => { dialog.showErrorBox('Unable to start Antiphon', String(error)); app.quit(); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  void Promise.all([worker?.terminate(), server?.close()]).finally(() => { library?.close(); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
