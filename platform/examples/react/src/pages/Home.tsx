import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main className="container">
      <section className="hero">
        <h1>VitalSage Demo — React</h1>
        <p className="lead">
          React + React Router version of the testing app. Validates that VitalSage
          correctly captures Core Web Vitals in a client-side routed SPA.
        </p>
        <div className="cta-group">
          <Link to="/products" className="btn btn-primary">View Products</Link>
          <Link to="/gallery"  className="btn btn-secondary">View Gallery</Link>
        </div>
      </section>

      <section className="scenarios">
        <h2>Test Scenarios</h2>
        <div className="cards">
          {[
            { icon: '🏠', title: 'Initial Load (here)',  desc: 'Static content — LCP from hero text, fast TTFB, minimal CLS.',         to: '/' },
            { icon: '📄', title: 'Navigation',           desc: 'Client-side route change — metrics should reset per navigation.',       to: '/about' },
            { icon: '🔄', title: 'Async / Spinner',      desc: 'Products fetched after 1.5 s delay — tests late-rendered LCP and CLS.', to: '/products' },
            { icon: '🖼️', title: 'Images',               desc: 'Gallery of images — LCP from largest image, CLS from unsized images.',  to: '/gallery' },
            { icon: '⚙️', title: 'CPU Heavy',            desc: 'Blocking JS loop — tests TBT, long tasks, and INP.',                   to: '/heavy' },
          ].map(({ icon, title, desc, to }) => (
            <div className="card" key={to}>
              <div className="card-icon">{icon}</div>
              <h3>{title}</h3>
              <p>{desc}</p>
              <Link to={to} className="btn btn-sm">Open</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="info">
        <h2>What to Check</h2>
        <ul>
          <li>Open DevTools → Console — VitalSage logs each metric as it fires.</li>
          <li>Watch the <strong>debug panel</strong> (bottom-right) update in real time.</li>
          <li>Navigate between pages — metrics should reset on each route change.</li>
          <li>
            Check the Express server at{' '}
            <a href="http://localhost:3001/api/sessions" target="_blank" rel="noreferrer">
              localhost:3001/api/sessions
            </a>{' '}
            for saved session data.
          </li>
          <li>Application tab → IndexedDB → vitalsage → sessions for stored reports.</li>
        </ul>
      </section>
    </main>
  );
}
