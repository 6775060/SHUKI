import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { StudioEvent } from '../main/api.js';

type CallResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

contextBridge.exposeInMainWorld('studio', {
  call: (method: string, ...args: unknown[]): Promise<CallResult> => ipcRenderer.invoke('studio:call', method, args),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('studio:pickFolder'),
  reveal: (path: string): Promise<boolean> => ipcRenderer.invoke('studio:reveal', path),
  pluginManifest: (): Promise<string | null> => ipcRenderer.invoke('studio:pluginManifest'),
  revealPlugin: (): Promise<boolean> => ipcRenderer.invoke('studio:revealPlugin'),
  onEvent: (cb: (e: StudioEvent) => void) => {
    const handler = (_: IpcRendererEvent, e: StudioEvent) => cb(e);
    ipcRenderer.on('studio:event', handler);
    return () => ipcRenderer.removeListener('studio:event', handler);
  },
});
