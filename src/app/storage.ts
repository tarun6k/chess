// Crash-safe key-value persistence. Uses Capacitor Preferences on-device
// (survives WebView storage eviction) and localStorage on the web; writes go
// to BOTH so a mid-write crash still leaves one good copy.

import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const native = Capacitor.isNativePlatform();

export async function loadKey<T>(key: string): Promise<T | null> {
  try {
    let raw: string | null = null;
    if (native) {
      raw = (await Preferences.get({ key })).value;
    }
    if (raw === null) raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveKey(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  try { localStorage.setItem(key, raw); } catch { /* quota */ }
  if (native) {
    try { await Preferences.set({ key, value: raw }); } catch { /* ignore */ }
  }
}

export async function removeKey(key: string): Promise<void> {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  if (native) {
    try { await Preferences.remove({ key }); } catch { /* ignore */ }
  }
}
