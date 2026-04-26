'use client';

import { useState } from 'react';

type Tab = 'sized' | 'unsized';

const SIZED = [
  { seed: 'ps1', caption: 'Mountain Sunrise' },
  { seed: 'ps2', caption: 'Forest Path'      },
  { seed: 'ps3', caption: 'Ocean Shore'      },
  { seed: 'ps4', caption: 'City at Night'    },
  { seed: 'ps5', caption: 'Desert Dunes'     },
  { seed: 'ps6', caption: 'Snow Peaks'       },
];

const UNSIZED = [
  { seed: 'ps7',  w: 800, h: 600, caption: '⚠️ Hero Image (no size attrs — CLS)' },
  { seed: 'ps8',  w: 600, h: 400, caption: 'Waterfall'                            },
  { seed: 'ps9',  w: 600, h: 400, caption: 'Canyon'                               },
  { seed: 'ps10', w: 600, h: 400, caption: 'Rainforest'                           },
];

export default function GalleryPage() {
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
          <li><strong>LCP</strong> — largest image in viewport is the LCP candidate.</li>
          <li><strong>CLS</strong> — switch to "Unsized" tab to trigger layout shifts.</li>
          <li><strong>next/image vs plain img</strong> — the sized tab uses plain img with explicit dimensions; both prevent CLS.</li>
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
          {SIZED.map(({ seed, caption }) => (
            <figure key={seed} className="gallery-item">
              {/* Plain img with explicit dimensions — no layout shift */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://picsum.photos/seed/${seed}/600/400`}
                width={600} height={400}
                alt={caption}
                loading="lazy"
              />
              <figcaption>{caption}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="gallery-grid" role="tabpanel">
          {UNSIZED.map(({ seed, w, h, caption }) => (
            <figure key={seed} className="gallery-item">
              {/* No width/height → layout shift */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://picsum.photos/seed/${seed}/${w}/${h}`}
                alt={caption}
              />
              <figcaption>{caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
