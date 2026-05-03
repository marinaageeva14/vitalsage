import { useState } from 'react';

type Tab = 'sized' | 'unsized';

const SIZED_IMAGES = [
  { seed: 'ps1', alt: 'Mountain Sunrise',  caption: 'Mountain Sunrise' },
  { seed: 'ps2', alt: 'Forest Path',       caption: 'Forest Path' },
  { seed: 'ps3', alt: 'Ocean Shore',       caption: 'Ocean Shore' },
  { seed: 'ps4', alt: 'City at Night',     caption: 'City at Night' },
  { seed: 'ps5', alt: 'Desert Dunes',      caption: 'Desert Dunes' },
  { seed: 'ps6', alt: 'Snow Peaks',        caption: 'Snow Peaks' },
];

const UNSIZED_IMAGES = [
  { seed: 'ps7',  alt: 'Hero landscape — LCP candidate',  caption: '⚠️ Hero Image (no size attrs — triggers CLS)', w: 800, h: 600 },
  { seed: 'ps8',  alt: 'Waterfall',                       caption: 'Waterfall',                                    w: 600, h: 400 },
  { seed: 'ps9',  alt: 'Canyon',                          caption: 'Canyon',                                       w: 600, h: 400 },
  { seed: 'ps10', alt: 'Rainforest',                      caption: 'Rainforest',                                   w: 600, h: 400 },
];

export default function Gallery() {
  const [tab, setTab] = useState<Tab>('sized');

  return (
    <main className="container">
      <section className="page-header">
        <h1>Gallery</h1>
        <p className="lead">Image loading — LCP and CLS test scenario.</p>
      </section>

      <div className="test-info">
        <strong>What this tests:</strong>
        <ul>
          <li><strong>LCP</strong> — the largest image in the viewport is the LCP candidate.</li>
          <li><strong>CLS</strong> — switch to "Unsized images" tab to trigger layout shifts.</li>
          <li><strong>Image LCP vs text LCP</strong> — LCP here should be higher than on Home.</li>
        </ul>
      </div>

      <div className="tabs" role="tablist">
        {(['sized', 'unsized'] as Tab[]).map(t => (
          <button
            key={t}
            className={`tab${tab === t ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'sized' ? '✅ Sized images (good CLS)' : '⚠️ Unsized images (bad CLS)'}
          </button>
        ))}
      </div>

      {tab === 'sized' ? (
        <div className="gallery-grid" role="tabpanel">
          {SIZED_IMAGES.map(({ seed, alt, caption }) => (
            <figure key={seed} className="gallery-item">
              <img
                src={`https://picsum.photos/seed/${seed}/600/400`}
                width={600} height={400}
                alt={alt}
                loading="lazy"
              />
              <figcaption>{caption}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="gallery-grid" role="tabpanel">
          {UNSIZED_IMAGES.map(({ seed, alt, caption, w, h }) => (
            <figure key={seed} className="gallery-item">
              {/* No width/height → layout shift as image loads */}
              <img
                src={`https://picsum.photos/seed/${seed}/${w}/${h}`}
                alt={alt}
              />
              <figcaption>{caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
