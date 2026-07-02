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

  function describeNode(node) {
    if (!node || !node.tagName) return node && node.nodeName ? node.nodeName : 'unknown';
    var cls = node.className ? '.' + String(node.className).trim().split(/\\s+/)[0] : '';
    return node.tagName + (node.id ? '#' + node.id : '') + cls;
  }

  // LCP phase attribution — the same decomposition web-vitals/attribution
  // provides for RUM: TTFB → resource load delay → load duration → render delay.
  function lcpAttribution(entry) {
    try {
      var nav  = performance.getEntriesByType('navigation')[0];
      var ttfb = nav ? Math.round(nav.responseStart) : 0;
      var attr = { timeToFirstByte: ttfb };
      if (entry.element) attr.element = describeNode(entry.element);
      if (entry.url) {
        attr.url = entry.url;
        var res = performance.getEntriesByType('resource').find(function(r) { return r.name === entry.url; });
        if (res) {
          attr.resourceLoadDelay    = Math.round(Math.max(0, res.fetchStart - ttfb));
          attr.resourceLoadDuration = Math.round(Math.max(0, res.responseEnd - res.fetchStart));
          attr.elementRenderDelay   = Math.round(Math.max(0, entry.startTime - res.responseEnd));
        }
      } else {
        attr.elementRenderDelay = Math.round(Math.max(0, entry.startTime - ttfb));
      }
      return attr;
    } catch(e) { return undefined; }
  }

  try {
    new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      var last = entries[entries.length - 1];
      if (last) {
        var v = last.startTime;
        var attr = lcpAttribution(last);
        window.__vitalsage_session.metrics.LCP = { name:'LCP', value:v, rating:rateMetric('LCP',v), delta:v, id:'sim-lcp', navigationType:'navigate', entries:[], attribution: attr };
      }
    }).observe({ type:'largest-contentful-paint', buffered:true });
  } catch(e) {}

  var clsValue = 0;
  var largestShift = null;
  try {
    new PerformanceObserver(function(list) {
      for (var entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        clsValue += entry.value;
        if (!largestShift || entry.value > largestShift.value) {
          var target = entry.sources && entry.sources.length && entry.sources[0].node
            ? describeNode(entry.sources[0].node) : undefined;
          largestShift = { value: entry.value, time: entry.startTime, target: target };
        }
      }
      var attr = largestShift ? {
        largestShiftValue: Math.round(largestShift.value * 10000) / 10000,
        largestShiftTime:  Math.round(largestShift.time),
        largestShiftTarget: largestShift.target,
      } : undefined;
      window.__vitalsage_session.metrics.CLS = { name:'CLS', value:clsValue, rating:rateMetric('CLS',clsValue), delta:0, id:'sim-cls', navigationType:'navigate', entries:[], attribution: attr };
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
          // Same phase split web-vitals/attribution reports for RUM INP.
          var attr = {
            inputDelay:         Math.round(Math.max(0, entry.processingStart - entry.startTime)),
            processingDuration: Math.round(Math.max(0, entry.processingEnd - entry.processingStart)),
            presentationDelay:  Math.round(Math.max(0, entry.startTime + entry.duration - entry.processingEnd)),
            interactionType:    entry.name,
            interactionTarget:  entry.target ? describeNode(entry.target) : undefined,
          };
          window.__vitalsage_session.metrics.INP = { name:'INP', value:maxInp, rating:rateMetric('INP',maxInp), delta:maxInp, id:'sim-inp', navigationType:'navigate', entries:[], attribution: attr };
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
