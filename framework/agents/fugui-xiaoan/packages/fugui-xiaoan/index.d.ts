// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/** 富贵小安 — 极简语音记账引擎 */

export interface RecordItem {
  id: string;
  category: string;
  item: string;
  amount: number;
  quantity?: number;
  unit?: string;
  date: string;
  createdAt: string;
}

export interface RecordResult {
  type: 'clarify' | 'confirm' | 'result';
  message?: string;
  record?: RecordItem;
  records?: RecordItem[];
  question?: string;
}

export interface QueryResult {
  type?: string;
  message?: string;
  records?: RecordItem[];
  question?: string;
}

export interface DeleteResult {
  type: 'clarify' | 'confirm' | 'result';
  message: string;
  targetId?: string;
  deletedId?: string;
}

export interface StorageBackend {
  save(record: RecordItem): Promise<RecordItem>;
  query(opts: { startDate?: string; endDate?: string; keyword?: string }): Promise<RecordItem[]>;
  all(): Promise<RecordItem[]>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export type ClarifyState = 'normal' | 'asked' | 'abandoned';
export type IntentType = 'record' | 'query' | 'delete' | 'other';
export type QuerySubIntent = 'single' | 'summary' | 'compare' | 'fuzzy';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  needConfirm?: boolean;
  needGuide?: boolean;
  question?: string;
}

export interface SubIntentResult {
  subIntent: QuerySubIntent;
  confidence: number;
  needConfirm?: boolean;
  needGuide?: boolean;
  question?: string;
}

export function createClarifyContext(): {
  checkAndAsk(id: string, question: string): boolean;
  handleReply(id: string, reply: string): Record<string, unknown>;
  getState(id: string): ClarifyState;
  getQuestion(id: string): string;
  cleanTimeouts(): void;
  clear(id: string): void;
};

export function classifyIntent(text: string): IntentResult;
export function classifyQuerySub(text: string): SubIntentResult;
export const CONFIDENCE_HIGH: number;
export const CONFIDENCE_MEDIUM: number;

export declare class MemoryStorage implements StorageBackend {
  constructor();
  save(record: RecordItem): Promise<RecordItem>;
  query(opts: { startDate?: string; endDate?: string; keyword?: string }): Promise<RecordItem[]>;
  all(): Promise<RecordItem[]>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export declare class LocalStorageStorage implements StorageBackend {
  constructor(key?: string);
  save(record: RecordItem): Promise<RecordItem>;
  query(opts: { startDate?: string; endDate?: string; keyword?: string }): Promise<RecordItem[]>;
  all(): Promise<RecordItem[]>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export declare class EncryptedLocalStorage implements StorageBackend {
  constructor(key: string, encryptKey: string);
  save(record: RecordItem): Promise<RecordItem>;
  query(opts: { startDate?: string; endDate?: string; keyword?: string }): Promise<RecordItem[]>;
  all(): Promise<RecordItem[]>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function createMemoryStorage(): MemoryStorage;
export function createLocalStorage(key?: string): LocalStorageStorage;
export function createEncryptedLocalStorage(key: string, encryptKey: string): Promise<EncryptedLocalStorage>;

export default class FuguiXiaoan {
  constructor(options?: {
    storage?: StorageBackend;
    mode?: 'simple' | 'detailed';
  });
  record(text: string): Promise<RecordResult>;
  query(text: string): Promise<QueryResult>;
  delete(text: string, options?: { confirmed?: boolean; targetId?: string }): Promise<DeleteResult>;
  getAllRecords(): Promise<RecordItem[]>;
  clearAll(): Promise<void>;
  setMode(mode: 'simple' | 'detailed'): void;
  getMode(): 'simple' | 'detailed';
  getModeLabel(): string;
  getModeColor(): string;
  storage: StorageBackend;
}
