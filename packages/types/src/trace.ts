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
  scriptingTime:      number;
  renderingTime:      number;
  paintingTime:       number;
  layoutCount:        number;
  styleRecalcCount:   number;
  domNodes:           number;
  jsListeners:        number;
  jsHeapUsed?:        number;
}
