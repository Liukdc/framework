// @MetaAgent v5.8 — tool-registry.js
// v5.5 工具分层：@section tools 必用 + @section tool_catalog 选用 + search_tools

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 宪法文本缓冲区上限（可通过 maxContextTokens tunable 调优） */
const CONSTITUTION_BUFFER_LIMIT = 4096;

/** DET 工具：确定性操作，模型通过 function calling 调用 */
const DET_TOOLS = {
  // 写盘
  writeOutput: {
    name: 'writeOutput',
    description: '将当前环节产出物写入持久存储',
    parameters: {
      type: 'object',
      properties: {
        intent:      { type: 'string', description: '当前环节 intent' },
        outputName:  { type: 'string', description: '产出物名称' },
        content:     { type: 'string', description: '产出物内容' },
      },
      required: ['intent', 'outputName', 'content'],
    },
    handler: async (args, ctx) => {
      const importance = ctx.importanceOf(args.intent);
      await ctx.contractStore.writeOutput(ctx.sessionId, args.intent, args.outputName, importance, args.content);
      return { success: true, importance };
    },
  },

  // 追加 topicEvolution event
  appendTopicEvent: {
    name: 'appendTopicEvent',
    description: '追加主题演化事件',
    parameters: {
      type: 'object',
      properties: {
        topicId:      { type: 'string' },
        intent:       { type: 'string' },
        changeLevel:  { type: 'string', enum: ['major', 'minor', 'patch', 'active', 'abandoned', 'checkpoint'] },
      },
      required: ['topicId', 'intent', 'changeLevel'],
    },
    handler: async (args, ctx) => {
      await ctx.contractStore.appendTopicEvent(ctx.sessionId, args.topicId, args.intent, args.changeLevel);
      return { success: true };
    },
  },

  // 读取已有产出物
  listOutputs: {
    name: 'listOutputs',
    description: '列出本会话已有产出物',
    parameters: { type: 'object', properties: {} },
    handler: async (args, ctx) => {
      const outputs = await ctx.contractStore.getOutputs(ctx.sessionId);
      return { outputs: outputs.map(o => ({ intent: o.intent, importance: o.importance, outputName: o.output_name })) };
    },
  },

  // 检查合规（DET 值域校验）
  validateField: {
    name: 'validateField',
    description: 'DET 值域校验（field_based N11/N12）',
    parameters: {
      type: 'object',
      properties: {
        fieldName:  { type: 'string' },
        value:      { type: 'string' },
        intent:     { type: 'string' },
      },
      required: ['fieldName', 'value', 'intent'],
    },
    handler: async (args, ctx) => {
      // N11/N12 field_based: 对账结果/拆包版本号
      if (args.intent === 'N11') {
        const valid = args.fieldName === 'contractResult' && ['pass', 'fail', 'partial'].includes(args.value);
        return { valid, message: valid ? 'ok' : `无效字段值: ${args.value}` };
      }
      if (args.intent === 'N12') {
        const valid = args.fieldName === 'packageVersion' && args.value.match(/^v?\d+\.\d+/);
        return { valid, message: valid ? 'ok' : `无效版本号: ${args.value}` };
      }
      return { valid: true, message: 'ok' };
    },
  },

  // N2: 双角色信息隔离——角色一只注场景定义
  n2InjectRole1: {
    name: 'n2InjectRole1',
    description: 'N2 双角色串行第1步：注入场景定义',
    parameters: {
      type: 'object',
      properties: {
        sceneDefinition: { type: 'string' },
      },
      required: ['sceneDefinition'],
    },
    handler: async (args, ctx) => {
      ctx.scheduler._n2Role1Output = args.sceneDefinition;
      return { success: true, step: 'role1_done' };
    },
  },

  // N2: 双角色信息隔离——角色二注角色一输出+N1边界
  n2InjectRole2: {
    name: 'n2InjectRole2',
    description: 'N2 双角色串行第2步：注入角色一输出+N1边界',
    parameters: {
      type: 'object',
      properties: {
        role1Output:  { type: 'string' },
        n1Boundary:   { type: 'string' },
      },
      required: ['role1Output', 'n1Boundary'],
    },
    handler: async (args, ctx) => {
      ctx.scheduler._n2Role2Context = { role1Output: args.role1Output, n1Boundary: args.n1Boundary };
      return { success: true, step: 'role2_ready' };
    },
  },
};

/** v5.5 tool_catalog: 选用工具，按环节需求加载 */
const OPTIONAL_TOOLS = {
  // 搜索已生成的 L2 文档
  searchOutputs: {
    name: 'searchOutputs',
    description: '搜索已生成的产出物',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      return ctx.contractStore.searchConversations(`session_id:${ctx.sessionId} ${args.query}`);
    },
  },

  // 读取环节宪法
  loadConstitution: {
    name: 'loadConstitution',
    description: '加载当前环节的宪法文本',
    parameters: {
      type: 'object',
      properties: { intent: { type: 'string' } },
      required: ['intent'],
    },
    handler: async (args, ctx) => {
      const text = ctx.getConstitution(args.intent);
      return { constitution: text.slice(0, CONSTITUTION_BUFFER_LIMIT), truncated: text.length > CONSTITUTION_BUFFER_LIMIT };
    },
  },
};

/** search_tools: 外部搜索能力 */
const SEARCH_TOOLS = {
  webSearch: {
    name: 'webSearch',
    description: '联网搜索态控架构相关文档',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      // 外部搜索 → 返回占位，由 adapter 处理
      return { note: 'search_tools: 请外部 adapter 处理搜索调用' };
    },
  },
};

/** 工具注册表 */
export class ToolRegistry {
  constructor(l3Path) {
    this._byName = new Map();

    // 必用工具（5个）
    for (const [key, tool] of Object.entries(DET_TOOLS)) {
      this._byName.set(tool.name, { ...tool, category: 'det', required: true });
    }

    // 选用工具
    for (const [key, tool] of Object.entries(OPTIONAL_TOOLS)) {
      this._byName.set(tool.name, { ...tool, category: 'optional', required: false });
    }

    // search_tools
    for (const [key, tool] of Object.entries(SEARCH_TOOLS)) {
      this._byName.set(tool.name, { ...tool, category: 'search', required: false });
    }
  }

  /** 获取所有可用工具定义（给 LLM function calling） */
  getToolDefinitions(intent) {
    this._ensureHighImportanceLoaded();
    const defs = [];
    // importance >= high 的 intent 获得全工具集；其他只给必用工具
    const hasFullTools = this._highImportanceIntents?.has(intent) || false;

    for (const [name, tool] of this._byName) {
      if (hasFullTools || tool.required) {
        defs.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        });
      }
    }
    return defs;
  }

  /** 从 L3 states.json 懒加载 high+critical importance intent 集合 */
  _ensureHighImportanceLoaded() {
    if (this._highImportanceIntents) return;
    try {
      const states = JSON.parse(readFileSync(join(this._l3Path, 'states.json'), 'utf-8'));
      this._highImportanceIntents = new Set(
        states.inSessionSubtypes
          .filter(s => s.importance === 'high' || s.importance === 'critical')
          .map(s => s.intent)
      );
    } catch {
      this._highImportanceIntents = new Set();
    }
  }

  /** 执行工具调用 */
  async execute(name, args, ctx) {
    const tool = this._byName.get(name);
    if (!tool) throw new Error(`未知工具: ${name}`);
    return tool.handler(args, ctx);
  }

  /** search_tools 列表 */
  getSearchTools() {
    return Object.values(SEARCH_TOOLS).map(t => t.name);
  }
}
