export interface LongTask {
  startTime: number;
  duration:  number;
  blocking:  number;  // duration - 50ms
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
}
