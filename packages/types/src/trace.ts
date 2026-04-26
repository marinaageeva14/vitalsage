export interface LongTask {
  startTime: number;
  duration:  number;
  blocking:  number;  // duration - 50ms
}

/**
 * Per-script execution time extracted from CDP trace events (EvaluateScript).
 * Only populated when `captureTrace: true` is passed to the simulator and
 * CDP Tracing events are collected (devtools.timeline category).
 */
export interface ScriptActivity {
  /** Script URL. Empty string means inline / anonymous / extension script. */
  url:   string;
  /** Total execution time for this script in milliseconds. */
  time:  number;
  /** Fraction of total scripting time (0–1). */
  share: number;
}

/**
 * Per-function CPU profile entry from the V8 CPU profiler.
 * Only present when `captureFullTrace: true` — same data that powers the
 * DevTools flame chart. Functions are de-duplicated across call-tree nodes
 * (same url + lineNumber → same function regardless of call path).
 */
export interface FunctionProfile {
  /** Function name as reported by V8. '(anonymous)' for arrow/unnamed functions. */
  functionName: string;
  /** Source URL of the script containing this function. */
  url:          string;
  /** 1-based line number in the source file. */
  lineNumber:   number;
  /**
   * Self time in ms — time spent executing this function's own instructions,
   * excluding time spent in called functions (equivalent to DevTools "Self Time").
   */
  selfTime:     number;
  /**
   * Total time in ms — self time + time in all descendant calls
   * (equivalent to DevTools "Total Time").
   */
  totalTime:    number;
  /** Number of times this function appeared in the profiler samples. */
  sampleCount:  number;
}

export interface TraceMetrics {
  totalBlockingTime:  number;
  longTaskCount:      number;
  longTasks:          LongTask[];
  mainThreadWork:     number;
  scriptingTime:      number;   // JS execution CPU time (V8 main thread)
  jsCompileTime:      number;   // JS parse + compile CPU time (subset of scripting)
  renderingTime:      number;   // style recalc + layout CPU time
  layoutCount:        number;
  styleRecalcCount:   number;
  domNodes:           number;
  jsListeners:        number;
  jsHeapUsed?:        number;
  /**
   * Per-script execution time, sorted by time descending.
   * Present only when CDP Tracing events were collected (captureTrace: true).
   */
  topScripts?:        ScriptActivity[];
  /**
   * Per-function CPU profile, sorted by selfTime descending.
   * Present only when captureFullTrace: true (--full-report flag).
   * Same data source as the DevTools flame chart.
   */
  topFunctions?:      FunctionProfile[];
}
