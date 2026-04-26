import Link from 'next/link';

export default function AboutPage() {
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
          library and adds session-level context.
        </p>
        <ul className="feature-list">
          <li><strong>LCP</strong> — Largest Contentful Paint</li>
          <li><strong>FCP</strong> — First Contentful Paint</li>
          <li><strong>TTFB</strong> — Time to First Byte (higher in SSR — includes server render)</li>
          <li><strong>CLS</strong> — Cumulative Layout Shift</li>
          <li><strong>INP</strong> — Interaction to Next Paint</li>
        </ul>
      </section>

      <section className="content-block">
        <h2>Next.js Navigation Test</h2>
        <p>
          Next.js App Router uses client-side navigation via <code>Link</code>. Metrics should
          reset on each route change, just as with the vanilla and React examples.
        </p>
        <div className="nav-test-links">
          <Link href="/"         className="btn btn-secondary">← Back to Home</Link>
          <Link href="/products" className="btn btn-primary">Products →</Link>
        </div>
      </section>

      <section className="content-block">
        <h2>SSR vs CSR Comparison</h2>
        <p>
          This page is a React Server Component — it is rendered to HTML on the server before
          the browser receives it. Compare TTFB and FCP here against the Vite React example
          (which renders entirely in the browser).
        </p>
        <ul className="feature-list">
          <li><strong>TTFB</strong> — should be slightly higher here (server render latency).</li>
          <li><strong>FCP</strong> — may be lower here (content arrives pre-rendered).</li>
          <li><strong>LCP</strong> — similar once images/large elements are in view.</li>
        </ul>
      </section>
    </main>
  );
}
