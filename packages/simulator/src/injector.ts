// Self-contained browser script injected via page.addInitScript.
// Must NOT import Node.js modules — serialized and run in browser context.
export const INJECTOR_SCRIPT = `
(function() {
  window.__vitalsage_session = { metrics: {}, longTasks: [], startTime: Date.now() };

  function rateMetric(name, value) {
    var t = { LCP:{g:2500,p:4000}, FCP:{g:1800,p:3000}, CLS:{g:0.1,p:0.25}, INP:{g:200,p:500}, TTFB:{g:800,p:1800} };
    var thresh = t[name];
    if (!thresh) return 'good';
    if (value <= thresh.g) return 'good';
    if (value <= thresh.p) return 'needs-improvement';
    return 'poor';
  }

  try {
    new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      var last = entries[entries.length - 1];
      if (last) {
        var v = last.startTime;
        window.__vitalsage_session.metrics.LCP = { name:'LCP', value:v, rating:rateMetric('LCP',v), delta:v, id:'sim-lcp', navigationType:'navigate', entries:[] };
      }
    }).observe({ type:'largest-contentful-paint', buffered:true });
  } catch(e) {}

  var clsValue = 0;
  try {
    new PerformanceObserver(function(list) {
      for (var entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
      window.__vitalsage_session.metrics.CLS = { name:'CLS', value:clsValue, rating:rateMetric('CLS',clsValue), delta:0, id:'sim-cls', navigationType:'navigate', entries:[] };
    }).observe({ type:'layout-shift', buffered:true });
  } catch(e) {}

  try {
    new PerformanceObserver(function(list) {
      for (var entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          var v = entry.startTime;
          window.__vitalsage_session.metrics.FCP = { name:'FCP', value:v, rating:rateMetric('FCP',v), delta:v, id:'sim-fcp', navigationType:'navigate', entries:[] };
          break;
        }
      }
    }).observe({ type:'paint', buffered:true });
  } catch(e) {}

  var maxInp = 0;
  try {
    new PerformanceObserver(function(list) {
      for (var entry of list.getEntries()) {
        if (entry.duration > maxInp) {
          maxInp = entry.duration;
          window.__vitalsage_session.metrics.INP = { name:'INP', value:maxInp, rating:rateMetric('INP',maxInp), delta:maxInp, id:'sim-inp', navigationType:'navigate', entries:[] };
        }
      }
    }).observe({ type:'event', buffered:true, durationThreshold:16 });
  } catch(e) {}

  // Collect long tasks (> 50ms) for Total Blocking Time calculation
  try {
    new PerformanceObserver(function(list) {
      for (var entry of list.getEntries()) {
        var blocking = entry.duration - 50;
        if (blocking > 0) {
          window.__vitalsage_session.longTasks.push({
            startTime: entry.startTime,
            duration:  entry.duration,
            blocking:  blocking,
          });
        }
      }
    }).observe({ type:'longtask', buffered:true });
  } catch(e) {}
})();
`;
