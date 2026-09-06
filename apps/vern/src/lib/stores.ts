import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PersonalStore, Store } from '@vern/core';

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let envLoaded = false;
function ensureEnv(): void {
  if (envLoaded) return;
  loadEnvFile(path.resolve(process.cwd(), '../../.env'));
  loadEnvFile(path.resolve(process.cwd(), '.env'));
  envLoaded = true;
}

declare global {
  // eslint-disable-next-line no-var
  var __vernCompany: Store | undefined;
  // eslint-disable-next-line no-var
  var __vernPersonal: PersonalStore | undefined;
}

export async function getCompanyStore(): Promise<Store> {
  ensureEnv();
  if (!globalThis.__vernCompany) {
    const dataDir = process.env.VERN_DATA_DIR || path.resolve(process.cwd(), 'data');
    const store = new Store({ dataDir });
    const ok = await store.load();
    if (!ok) {
      store.seedDemoData();
    }
    globalThis.__vernCompany = store;
  }
  return globalThis.__vernCompany;
}

export async function getPersonalStore(): Promise<PersonalStore> {
  ensureEnv();
  const existing = globalThis.__vernPersonal;
  // HMR can leave an old PersonalStore singleton without new methods
  if (!existing || typeof existing.getProfile !== 'function') {
    const dataDir = process.env.VERN_DATA_DIR || path.resolve(process.cwd(), 'data');
    const store = new PersonalStore({ dataDir });
    const ok = await store.load();
    if (!ok) store.seed();
    globalThis.__vernPersonal = store;
  }
  return globalThis.__vernPersonal;
}
