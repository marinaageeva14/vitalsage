'use client';

import { useState, useEffect, useRef } from 'react';

interface LogEntry { id: number; msg: string; type: 'info' | 'warn' | 'success' | 'error'; }

function blockThread(ms: number): number {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) { x++; }
  return x;
}

let _id = 0;

export default function HeavyPage() {
  const [log,       setLog]       = useState<LogEntry[]>([{ id: _id++, msg: 'Click "Run Computation" or wait for the auto-run.', type: 'info' }]);
  const [taskCount, setTaskCount] = useState(5);
  const [running,   setRunning]   = useState(false);
  const [domNodes,  setDomNodes]  = useState<number[]>([]);
  const [thrashMsg, setThrashMsg] = useState('');
  const didAutoRun = useRef(false);

  function addLog(msg: string, type: LogEntry['type'] = 'info') {
    setLog(prev => [{ id: _id++, msg: `[${new Date().toISOString().slice(11, 23)}] ${msg}`, type }, ...prev.slice(0, 49)]);
  }

  function runComputation(count: number) {
    setRunning(true);
    addLog(`Starting ${count} blocking tasks…`);
    let i = 0;
    function next() {
      if (i >= count) { setRunning(false); addLog(`Done. ${count} tasks completed.`, 'success'); return; }
      const t0 = performance.now(); const ops = blockThread(150); const dt = performance.now() - t0;
      addLog(`Task ${i + 1}/${count}: blocked ${dt.toFixed(1)} ms (${ops.toLocaleString()} ops)`, 'warn');
      i++; setTimeout(next, 10);
    }
    setTimeout(next, 0);
  }

  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    addLog('Auto-run: 2 blocking tasks during load phase…');
    blockThread(200); blockThread(200);
    addLog('Auto-run complete. TBT should reflect these tasks.', 'success');
  }, []);

  function thrashLayout() {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const w = document.body.offsetWidth;
      const el = document.getElementById('thrash-target');
      if (el) el.style.width = `${w - i}px`;
      total += w;
    }
    setThrashMsg(`Layout thrash complete. Total measured width: ${total}px`);
    addLog('Layout thrash: 10 forced reflows.', 'warn');
  }

  return (
    <main className="container">
      <section className="page-header">
        <h1>CPU-Heavy Page</h1>
        <p className="lead">Long tasks and TBT test scenario.</p>
      </section>

      <div className="test-info">
        <strong>What this tests:</strong>
        <ul>
          <li><strong>TBT</strong> — Two 200 ms blocking tasks run during component mount.</li>
          <li><strong>INP</strong> — Click "Run Computation" while the page loads.</li>
          <li><strong>Long Tasks</strong> — each step blocks ~150 ms.</li>
        </ul>
      </div>

      <div className="heavy-controls">
        <button className="btn btn-primary btn-lg" onClick={() => runComputation(taskCount)} disabled={running}>
          {running ? '⏳ Running…' : '▶ Run Computation'}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={() => setLog([])}>🗑 Clear Log</button>
        <label className="control-label">
          <input type="range" min={1} max={10} value={taskCount} onChange={e => setTaskCount(Number(e.target.value))} />
          <span>{taskCount} tasks × ~150 ms each</span>
        </label>
      </div>

      <div className="task-log">
        {log.length === 0
          ? <p className="log-hint">Log cleared.</p>
          : log.map(e => <p key={e.id} className={`log-entry log-${e.type}`}>{e.msg}</p>)
        }
      </div>

      <section className="heavy-section">
        <h2>DOM Stress</h2>
        <p>Creates 500 DOM nodes — tests rendering/layout time.</p>
        <button className="btn btn-secondary" onClick={() => { setDomNodes(Array.from({ length: 500 }, (_, i) => i + 1)); addLog('Injected 500 DOM nodes.', 'success'); }}>
          Inject 500 nodes
        </button>
        {domNodes.length > 0 && (
          <div className="dom-container">
            {domNodes.map(n => <div key={n} className="dom-node">Node {n}</div>)}
          </div>
        )}
      </section>

      <section className="heavy-section">
        <h2>Forced Layout Thrash</h2>
        <p>Reads and writes layout in a loop — triggers repeated style recalculations.</p>
        <button className="btn btn-secondary" onClick={thrashLayout}>Thrash Layout (10 reads/writes)</button>
        <div id="thrash-target" className="thrash-result">{thrashMsg}</div>
      </section>
    </main>
  );
}
