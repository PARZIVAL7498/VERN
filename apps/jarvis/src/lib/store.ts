import { JarvisStore } from '@vern/jarvis-core';

declare global {
  // eslint-disable-next-line no-var
  var __jarvisStore: JarvisStore | undefined;
}

export async function getJarvisStore(): Promise<JarvisStore> {
  if (!globalThis.__jarvisStore) {
    const store = new JarvisStore({
      dataDir: process.env.JARVIS_DATA_DIR || './data',
    });
    const loaded = await store.load();
    if (!loaded) store.seed();
    globalThis.__jarvisStore = store;
  }
  return globalThis.__jarvisStore;
}
