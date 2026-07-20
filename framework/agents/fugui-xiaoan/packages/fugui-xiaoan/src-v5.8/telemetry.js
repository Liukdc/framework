// SPDX-License-Identifier: MIT | Copyright (c) 2026 刘劲松
/**
 * OpenTelemetry 执行体调用链追踪 — 富贵小安 v5.8
 * @module fugui-xiaoan/telemetry-v5.8
 */

export const ExecutorType = Object.freeze({ DET:'DET', LLM:'LLM', HUMAN:'HUMAN' });
export const SpanStatus = Object.freeze({ SUCCESS:'success', FAIL:'fail', TIMEOUT:'timeout' });

let _collector = null;

export class TelemetryCollector {
  constructor() { this._spans = []; this._sessionTraceId = `trace_${Date.now()}`; }
  startSpan(executorType, executorName, parentSpanId = null) {
    const span = {
      traceId: this._sessionTraceId, spanId: `span_${this._spans.length}`,
      parentSpanId, executorType, executorName,
      startTime: Date.now(), endTime: null, status: null,
      inputSummary: null, outputSummary: null, errorDetail: null,
    };
    this._spans.push(span);
    return span;
  }
  endSpan(span, status, outputSummary = null, errorDetail = null) {
    span.endTime = Date.now(); span.status = status;
    span.outputSummary = outputSummary; span.errorDetail = errorDetail;
  }
  getSpans() { return [...this._spans]; }
  getMetrics() {
    const detSpans = this._spans.filter(s => s.executorType === ExecutorType.DET);
    const llmSpans = this._spans.filter(s => s.executorType === ExecutorType.LLM);
    return {
      detCallCount: detSpans.length, llmCallCount: llmSpans.length,
      detFailRate: detSpans.length ? (detSpans.filter(s => s.status === SpanStatus.FAIL).length / detSpans.length * 100).toFixed(1) + '%' : '0%',
      avgLlmLatency: llmSpans.length ? Math.round(llmSpans.reduce((s, sp) => s + (sp.endTime - sp.startTime), 0) / llmSpans.length) + 'ms' : 'N/A',
    };
  }
  exportToJson(path) { /* 写入文件供 Jaeger/Zipkin 消费 */ }
}

export class NullTelemetryCollector {
  startSpan() { return {}; }
  endSpan() {}
  getSpans() { return []; }
  getMetrics() { return { detCallCount:0, llmCallCount:0 }; }
}
