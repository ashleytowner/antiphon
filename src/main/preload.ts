import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, ScanProgress } from '../shared/types';
const api: DesktopAPI = {
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  scan: () => ipcRenderer.invoke('library:scan'),
  query: value => ipcRenderer.invoke('library:query', value),
  facets: () => ipcRenderer.invoke('library:facets'),
  classify: (id, value) => ipcRenderer.invoke('library:edit', id, value),
  broadcast: offer => ipcRenderer.invoke('broadcast:start', offer),
  stopBroadcast: () => ipcRenderer.invoke('broadcast:stop'),
  serverStatus: () => ipcRenderer.invoke('server:status'),
  onScan: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: ScanProgress) => callback(value);
    ipcRenderer.on('library:progress', listener);
    return () => ipcRenderer.removeListener('library:progress', listener);
  }
};
contextBridge.exposeInMainWorld('rpg', api);
