import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('rpg', { version: '0.1.0' });
