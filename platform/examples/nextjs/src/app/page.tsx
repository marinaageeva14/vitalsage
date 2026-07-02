import Link from 'next/link';
import DomBloat from '../components/DomBloat';

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>VitalSage Demo — Next.js</h1>
        <p className="lead">
          Next.js App Router version of the testing app. Validates that VitalSage correctly captures
          Core Web Vitals with SSR, RSC, and client-side navigation.
        </p>
        <div className="cta-group">
          <Link href="/products" className="btn btn-primary">View Products</Link>
          <Link href="/gallery"  className="btn btn-secondary">View Gallery</Link>
        </div>
      </section>

      <section className="scenarios">
        <h2>Test Scenarios</h2>
        <div className="cards">
          {[
            { icon: '🏠', title: 'Initial Load (here)',  desc: 'SSR page — TTFB includes server render time. LCP from hero text.',                   href: '/'         },
            { icon: '📄', title: 'Navigation',           desc: 'Client-side route change with Next.js Link — metrics reset per navigation.',         href: '/about'    },
            { icon: '🔄', title: 'Async / Spinner',      desc: 'Products fetched in a client component after 1.5 s delay — LCP and CLS scenario.',   href: '/products' },
            { icon: '🖼️', title: 'Images',               desc: 'Gallery — LCP from largest image, CLS comparison (sized vs unsized).',               href: '/gallery'  },
            { icon: '⚙️', title: 'CPU Heavy',            desc: 'Blocking JS loop — TBT, long tasks, INP test.',                                      href: '/heavy'    },
          ].map(({ icon, title, desc, href }) => (
            <div className="card" key={href}>
              <div className="card-icon">{icon}</div>
              <h3>{title}</h3>
              <p>{desc}</p>
              <Link href={href} className="btn btn-sm">Open</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="info">
        <h2>What to Check</h2>
        <ul>
          <li>Open DevTools → Console — VitalSage logs each metric as it fires.</li>
          <li>Watch the <strong>debug panel</strong> (bottom-right) update in real time.</li>
          <li>
            Compare TTFB here (SSR) vs the Vite React example (CSR) — SSR adds server render time.
          </li>
          <li>
            Check{' '}
            <a href="http://localhost:3001/api/sessions" target="_blank" rel="noreferrer">
              localhost:3001/api/sessions
            </a>{' '}
            for saved sessions.
          </li>
          <li>Application → IndexedDB → vitalsage → sessions for locally stored reports.</li>
        </ul>
      </section>

      {/* SYNTHETIC PERF ISSUE: 3 000 hidden DOM nodes — triggers domNodes >= 2500 rule */}
      <DomBloat />
    </main>
  );
}
