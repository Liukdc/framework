// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * 富贵小安 E2E 测试（Playwright）— v2.0 对话式 UI 适配
 *
 * 运行：npx playwright test --config=playwright.config.js
 */
import { test, expect } from '@playwright/test';

const APP_URL = 'http://localhost:8899';

test.describe('富贵小安 PWA E2E (对话式 UI)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
  });

  // ═══ Test 1: 页面加载 ═══════════════════
  test('页面加载 → 聊天界面可见', async ({ page }) => {
    await expect(page.locator('#page-chat')).toBeVisible();
    await expect(page.locator('#chatInput')).toBeVisible();
    await expect(page.locator('#chatList')).toBeVisible();
  });

  // ═══ Test 2: Tab 导航 ═══════════════════
  test('Tab导航：聊天/统计/设置切换正常', async ({ page }) => {
    // 默认在聊天
    await expect(page.locator('#page-chat')).toHaveClass(/active/);

    // 切到统计
    await page.click('[data-page="stats"]');
    await expect(page.locator('#page-stats')).toHaveClass(/active/);
    await expect(page.locator('#statCount')).toBeVisible();
    await expect(page.locator('#statTotal')).toBeVisible();

    // 切到设置
    await page.click('[data-page="settings"]');
    await expect(page.locator('#page-settings')).toHaveClass(/active/);
    await expect(page.locator('#apiKeyInput')).toBeVisible();

    // 切回聊天
    await page.click('[data-page="chat"]');
    await expect(page.locator('#page-chat')).toHaveClass(/active/);
  });

  // ═══ Test 3: 聊天输入 ═══════════════════
  test('聊天输入 → 发送消息后出现在对话列表', async ({ page }) => {
    const input = page.locator('#chatInput');
    await input.fill('你好');
    await page.click('.send-btn');

    // 消息应出现在聊天列表
    const bubbles = page.locator('#chatList .chat-bubble');
    await expect(bubbles.first()).toBeVisible({ timeout: 3000 });
    expect(await bubbles.count()).toBeGreaterThanOrEqual(1);
  });

  // ═══ Test 4: 设置页元素 ═══════════════════
  test('设置页：API Key输入/导出按钮/清空按钮可见', async ({ page }) => {
    await page.click('[data-page="settings"]');
    await expect(page.locator('#apiKeyInput')).toBeVisible();
    await expect(page.locator('button:has-text("导出")').first()).toBeVisible();
    await expect(page.locator('button:has-text("清空")')).toBeVisible();
  });

  // ═══ Test 5: 唤醒词交互 ═══════════════════
  test('输入唤醒词 → 对话引擎响应', async ({ page }) => {
    const input = page.locator('#chatInput');
    // 注入 API Key 让引擎不阻塞
    await page.evaluate(() => {
      localStorage.setItem('fugui_nlu_apikey', btoa('sk-test-key-for-e2e'.split('').map(c =>
        String.fromCharCode(c.charCodeAt(0) ^ 'a3f7'.charCodeAt(0))
      ).join('')));
    });
    // 刷新页面让 API Key 加载
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);

    // 发送唤醒词
    await input.fill('小安出来记一下');
    await page.click('.send-btn');
    await page.waitForTimeout(1500);

    // 检查聊天列表有新的消息
    const bubbles = page.locator('#chatList .chat-bubble');
    expect(await bubbles.count()).toBeGreaterThanOrEqual(1);
  });

  // ═══ Test 6: 模式切换 ═══════════════════
  test('模式切换 → 标题变更', async ({ page }) => {
    const title = page.locator('#headerTitle');
    await expect(title).toContainText('简单');

    // 点击模式切换
    await page.click('.mode-switch');
    await page.waitForTimeout(300);
    await expect(title).toContainText('细致');
  });
});
