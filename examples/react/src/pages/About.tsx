import { Link } from 'react-router-dom';

export default function About() {
  return (
    <main className="container">
      <section className="page-header">
        <h1>About VitalSage</h1>
        <p className="lead">An open-source SDK for measuring and analysing browser performance metrics.</p>
      </section>

      <section className="content-block">
        <h2>What Does VitalSage Measure?</h2>
        <p>
          VitalSage wraps the{' '}
          <a href="https://github.com/GoogleChrome/web-vitals" target="_blank" rel="noreferrer">web-vitals</a>{' '}
          library and adds session-level context: device category, network conditions, route path,
          and optional trace data captured via CDP.
        </p>
        <ul className="feature-list">
          <li><strong>LCP</strong> — Largest Contentful Paint: when the biggest visible element renders.</li>
          <li><strong>FCP</strong> — First Contentful Paint: first pixel of text or image.</li>
          <li><strong>TTFB</strong> — Time to First Byte: server response latency.</li>
          <li><strong>CLS</strong> — Cumulative Layout Shift: visual stability score.</li>
          <li><strong>INP</strong> — Interaction to Next Paint: responsiveness to user input.</li>
        </ul>
      </section>

      <section className="content-block">
        <h2>SPA Navigation Test</h2>
        <p>
          In a React SPA, metrics reset on each route change. Navigate between pages and confirm
          that the debug panel resets and a new session is created per page.
        </p>
        <div className="nav-test-links">
          <Link to="/"        className="btn btn-secondary">← Back to Home</Link>
          <Link to="/products" className="btn btn-primary">Products →</Link>
        </div>
      </section>

      <section className="content-block">
        <h2>Storage Adapters</h2>
        <p>This demo wires up two adapters:</p>
        <ol style={{ paddingLeft: '20px', marginTop: '8px' }}>
          <li style={{ marginBottom: '8px' }}>
            <strong>IndexedDB</strong> — each session report is written to the <code>vitalsage</code>{' '}
            database, <code>sessions</code> store. Open DevTools → Application → IndexedDB.
          </li>
          <li>
            <strong>Express server</strong> — session reports are POSTed to{' '}
            <code>http://localhost:3001/api/session</code>.
          </li>
        </ol>
      </section>
    </main>
  );
}
