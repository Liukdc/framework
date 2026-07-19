// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/** 杂碎本 — 极简碎片记录与定时清理 */

export type RecordStatus = 'pending' | 'kept' | 'deleted' | 'archived' | 'abandoned';
export type SessionState = 'idle' | 'recording' | 'cleanup';

export interface FragmentRecord {
  id: string;
  name: string;
  content: string;
  status: RecordStatus;
  createdAt: string;
  isTemporary: boolean;
  skipCount: number;
  organizeTime: string | null;
  attachments: Array<{ type: string; path: string; size: number; createdAt: string }>;
}

export interface RecordInput {
  type: 'record';
  name: string;
  content: string;
  isTemporary: boolean;
  _savePromise?: Promise<FragmentRecord>;
}

export interface ZacuibenStats {
  total: number;
  pending: number;
  kept: number;
  deleted: number;
  archived: number;
  abandoned: number;
}

export interface CleanupProgress { current: number; total: number; }

export interface StorageBackend {
  save(record: FragmentRecord): Promise<FragmentRecord>;
  getById(id: string): Promise<FragmentRecord | null>;
  all(): Promise<FragmentRecord[]>;
  query(opts: { keyword?: string }): Promise<FragmentRecord[]>;
  remove(id: string): Promise<boolean>;
  removePermanently(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export declare class CleanupSession {
  current(): { record: FragmentRecord; displayText: string } | null;
  decide(action: 'keep' | 'delete' | 'archive' | 'skip'): Promise<void>;
  nameTemp(id: string, newKey: string): Promise<void>;
  getProgress(): CleanupProgress;
}

export declare class ProtectionManager {
  protectFragment(id: string): void;
  unprotectFragment(id: string): void;
  isProtected(id: string): boolean;
  verifyDelete(id: string): boolean;
}

export declare class MemoryStorage implements StorageBackend {
  constructor();
  save(record: FragmentRecord): Promise<FragmentRecord>;
  getById(id: string): Promise<FragmentRecord | null>;
  all(): Promise<FragmentRecord[]>;
  query(opts: { keyword?: string }): Promise<FragmentRecord[]>;
  remove(id: string): Promise<boolean>;
  removePermanently(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export declare class LocalStorageStorage implements StorageBackend {
  constructor(key?: string);
  save(record: FragmentRecord): Promise<FragmentRecord>;
  getById(id: string): Promise<FragmentRecord | null>;
  all(): Promise<FragmentRecord[]>;
  query(opts: { keyword?: string }): Promise<FragmentRecord[]>;
  remove(id: string): Promise<boolean>;
  removePermanently(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function createMemoryStorage(key?: string): MemoryStorage;
export function createLocalStorage(key?: string): LocalStorageStorage;

export default class Zacuiben {
  constructor(options: { storage: StorageBackend });
  record(text: string): RecordInput;
  addAttachment(id: string, file: { type: string; size: number; name: string }): { accepted: boolean; reason?: string };
  setOrganizeTime(id: string, timeStr: string): { time: string | null };
  search(query: string): Promise<FragmentRecord[]>;
  startCleanup(): Promise<CleanupSession>;
  nameFragment(id: string, newKey: string): Promise<boolean>;
  skipFragment(id: string): Promise<void>;
  abandonFragment(id: string): Promise<void>;
  checkAutoCleanup(): Promise<void>;
  recoverFromBin(id: string): Promise<boolean>;
  checkOrganizeReminders(callback: (record: FragmentRecord) => void): void;
  addFragment(text: string): FragmentRecord;
  getStats(): ZacuibenStats;
  storage: StorageBackend;
}
