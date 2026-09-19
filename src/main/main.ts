import { app, BrowserWindow } from 'electron';
import path from 'node:path';

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1400, height: 950, minWidth: 1000, minHeight: 650,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  window.loadFile(path.join(__dirname, '../renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
