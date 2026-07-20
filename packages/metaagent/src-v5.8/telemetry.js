// @MetaAgent v5.8 — telemetry.js
// OpenTelemetry 追踪：trace 链、metric 计数、审计事件

export class Telemetry {
  constructor() {
    this._traces = [];
    this._metrics = {
      totalSessions: 0,
      totalTurns: 0,
      intentDistribution: {},
      stateTransitions: {},
      criticalOutputsWritten: 0,
      criticalOutputsFailed: 0,
      errors: 0,
    };
  }

  /** 创建 trace */
  startTrace(name, attrs = {}) {
    const trace = {
      id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      startTime: Date.now(),
      attrs,
      events: [],
    };
    this._traces.push(trace);
    return trace;
  }

  /** 记录事件 */
  logEvent(trace, event, detail = {}) {
    if (!trace) return;
    trace.events.push({ event, timestamp: Date.now(), ...detail });
  }

  /** 结束 trace */
  endTrace(trace, status = 'ok') {
    if (!trace) return;
    trace.endTime = Date.now();
    trace.status = status;
    trace.durationMs = trace.endTime - trace.startTime;
  }

  /** 递增指标 */
  inc(name, by = 1) {
    if (this._metrics[name] !== undefined) {
      this._metrics[name] += by;
    }
  }

  /** 记录 intent */
  recordIntent(intent) {
    this._metrics.intentDistribution[intent] =
      (this._metrics.intentDistribution[intent] || 0) + 1;
  }

  /** 记录状态转移 */
  recordTransition(from, to) {
    const key = `${from}->${to}`;
    this._metrics.stateTransitions[key] =
      (this._metrics.stateTransitions[key] || 0) + 1;
  }

  /** 取指标快照 */
  snapshot() {
    return { ...this._metrics };
  }

  /** 取最近 trace */
  recentTraces(n = 10) {
    return this._traces.slice(-n);
  }
}

// 单例
export const telemetry = new Telemetry();
