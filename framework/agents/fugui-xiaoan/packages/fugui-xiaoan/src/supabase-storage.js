// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * Supabase 云存储适配器 — 多用户账本同步
 *
 * 实现 StorageBackend 接口，用户数据存 Supabase Postgres，
 * 配合 RLS（Row Level Security）确保每人只看自己的账本。
 *
 * @module fugui-xiaoan/supabase-storage
 */
import { StorageBackend } from './storage.js';

const RECORDS_TABLE = 'records';

/**
 * @class SupabaseStorage
 * @implements {StorageBackend}
 */
export class SupabaseStorage extends StorageBackend {
  /**
   * @param {Object} supabaseClient — Supabase 客户端实例（已认证）
   */
  constructor(supabaseClient) {
    super();
    this._client = supabaseClient;
  }

  async save(record) {
    const user = await this._getUser();
    if (!user) throw new Error('请先登录');

    const { data, error } = await this._client
      .from(RECORDS_TABLE)
      .insert({
        user_id: user.id,
        category: record.category || record.name || '',
        item: record.item || record.content || '',
        amount: parseFloat(record.amount) || 0,
        content: record.content || '',
        date: record.date || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`保存失败：${error.message}`);
    return {
      id: data.id,
      category: data.category,
      item: data.item,
      amount: data.amount,
      content: data.content,
      date: data.date,
      createdAt: data.created_at,
    };
  }

  async query(query) {
    const user = await this._getUser();
    if (!user) throw new Error('请先登录');

    let q = this._client.from(RECORDS_TABLE).select('*').eq('user_id', user.id);

    if (query.category) q = q.eq('category', query.category);
    if (query.keyword) q = q.ilike('item', `%${query.keyword}%`);
    if (query.dateFrom) q = q.gte('date', query.dateFrom);
    if (query.dateTo) q = q.lte('date', query.dateTo);

    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw new Error(`查询失败：${error.message}`);
    return (data || []).map(rowToRecord);
  }

  async all() {
    const user = await this._getUser();
    if (!user) throw new Error('请先登录');

    const { data, error } = await this._client
      .from(RECORDS_TABLE)
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false });

    if (error) throw new Error(`读取失败：${error.message}`);
    return (data || []).map(rowToRecord);
  }

  async remove(id) {
    const user = await this._getUser();
    if (!user) throw new Error('请先登录');

    const { error } = await this._client
      .from(RECORDS_TABLE)
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw new Error(`删除失败：${error.message}`);
  }

  async clear() {
    const user = await this._getUser();
    if (!user) throw new Error('请先登录');

    const { error } = await this._client
      .from(RECORDS_TABLE)
      .delete()
      .eq('user_id', user.id);

    if (error) throw new Error(`清空失败：${error.message}`);
  }

  async _getUser() {
    const { data } = await this._client.auth.getUser();
    return data?.user || null;
  }
}

function rowToRecord(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.category,
    item: row.item,
    content: row.content || row.item,
    amount: row.amount,
    date: row.date,
    createdAt: row.created_at,
  };
}

/**
 * Supabase 客户端工厂
 * @param {string} url — Supabase Project URL
 * @param {string} anonKey — Supabase anon key
 * @returns Supabase 客户端实例（需在项目中安装 @supabase/supabase-js）
 */
export function createSupabaseClient(url, anonKey) {
  // 动态加载 Supabase SDK（CDN 方式，不依赖 npm）
  if (window.supabase) return window.supabase.createClient(url, anonKey);
  throw new Error('请先加载 Supabase SDK: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm">');
}

/**
 * 创建数据库表的 SQL（在 Supabase SQL Editor 中执行一次）
 */
export const DB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  category text DEFAULT '',
  item text DEFAULT '',
  amount numeric DEFAULT 0,
  content text DEFAULT '',
  date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own records"
  ON records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own records"
  ON records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own records"
  ON records FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own records"
  ON records FOR DELETE
  USING (auth.uid() = user_id);
`;
