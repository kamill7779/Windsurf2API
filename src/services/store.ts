/**
 * Simple JSON file persistence layer
 * Zero dependencies — uses node:fs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { log } from '../config.js';

const DATA_DIR = './data';

function dataPath(key: string): string {
  return `${DATA_DIR}/${key}.json`;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadData<T>(key: string, fallback: T): T {
  ensureDir();
  const path = dataPath(key);
  try {
    if (!existsSync(path)) return fallback;
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (e: any) {
    log.warn(`Failed to load ${key}:`, e.message);
    return fallback;
  }
}

export function saveData<T>(key: string, data: T): void {
  ensureDir();
  const path = dataPath(key);
  try {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e: any) {
    log.error(`Failed to save ${key}:`, e.message);
  }
}
