'use strict';

/**
 * preload.js
 * --------------------------------------------------------------------------
 * The ONLY bridge between the renderer and the main process. Exposes exactly
 * the methods listed in the build spec (Part 7) and nothing else. ipcRenderer
 * is never handed to the renderer directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Subscribe helper that strips the IpcRendererEvent and returns an unsubscribe fn. */
function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('workerAPI', {
  start: (config) => ipcRenderer.invoke('worker-start', config),
  stop: () => ipcRenderer.invoke('worker-stop'),

  onLog: (cb) => subscribe('worker-log', cb),
  onStatus: (cb) => subscribe('worker-status', cb),

  saveSettings: (env) => ipcRenderer.invoke('save-settings', env),
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  // First-launch worker setup (bundled worker dependency install).
  getSetupStatus: () => ipcRenderer.invoke('get-setup-status'),
  installWorker: () => ipcRenderer.invoke('install-worker'),
  onSetupLog: (cb) => subscribe('setup-log', cb),

  /**
   * Enumerate audio input devices.
   *
   * NOTE: the spec sketched this as ipcRenderer.invoke('list-audio-devices'),
   * but audio enumeration is a Web API (navigator.mediaDevices) that only
   * exists in the renderer — the Electron main process cannot enumerate inputs
   * without native modules. Per Part 1 ("via navigator.mediaDevices
   * .enumerateDevices") we do it here. A transient getUserMedia() call unlocks
   * the device labels; the OS mic permission is granted by the main process.
   */
  listAudioDevices: async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_) {
        // No permission / no device — we can still enumerate (labels may be blank).
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Audio input ${i + 1}`,
        }));
    } catch (err) {
      return [];
    }
  },
});
