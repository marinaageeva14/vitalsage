import { useState, useEffect } from 'react';

interface Product {
  id:       number;
  name:     string;
  price:    number;
  category: 'electronics' | 'clothing' | 'books';
  rating:   number;
  reviews:  number;
}

const PRODUCTS: Product[] = [
  { id: 1,  name: 'Wireless Headphones',        price: 79.99,  category: 'electronics', rating: 4.5, reviews: 312  },
  { id: 2,  name: 'Running Shoes',               price: 59.99,  category: 'clothing',    rating: 4.2, reviews: 198  },
  { id: 3,  name: 'JavaScript: The Good Parts',  price: 24.99,  category: 'books',       rating: 4.8, reviews: 901  },
  { id: 4,  name: 'USB-C Hub',                   price: 39.99,  category: 'electronics', rating: 4.0, reviews: 447  },
  { id: 5,  name: 'Yoga Mat',                    price: 29.99,  category: 'clothing',    rating: 4.6, reviews: 263  },
  { id: 6,  name: 'Clean Code',                  price: 32.99,  category: 'books',       rating: 4.7, reviews: 1204 },
  { id: 7,  name: 'Mechanical Keyboard',         price: 119.99, category: 'electronics', rating: 4.9, reviews: 532  },
  { id: 8,  name: 'Hoodie',                      price: 44.99,  category: 'clothing',    rating: 4.3, reviews: 87   },
  { id: 9,  name: 'The Pragmatic Programmer',    price: 37.99,  category: 'books',       rating: 4.9, reviews: 2011 },
  { id: 10, name: 'Portable Charger',            price: 34.99,  category: 'electronics', rating: 4.1, reviews: 679  },
  { id: 11, name: 'Denim Jacket',                price: 64.99,  category: 'clothing',    rating: 4.4, reviews: 156  },
  { id: 12, name: 'Refactoring',                 price: 41.99,  category: 'books',       rating: 4.8, reviews: 743  },
];

const CATEGORY_ICONS = { electronics: '🔌', clothing: '👕', books: '📚' } as const;
type Category = 'all' | 'electronics' | 'clothing' | 'books';

function stars(r: number) {
  return '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));
}

export default function Products() {
  const [products, setProducts]       = useState<Product[] | null>(null);
  const [filter, setFilter]           = useState<Category>('all');
  const [addedIds, setAddedIds]       = useState<Set<number>>(new Set());
  const [filtersVisible, setFilters]  = useState(false);

  // Simulate async fetch with 1.5 s delay
  useEffect(() => {
    const t = setTimeout(() => {
      setProducts(PRODUCTS);
      setTimeout(() => setFilters(true), 200); // intentional CLS
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  function addToCart(id: number) {
    setAddedIds(prev => new Set([...prev, id]));
    setTimeout(() => setAddedIds(prev => { const s = new Set(prev); s.delete(id); return s; }), 1500);
  }

  const visible = products?.filter(p => filter === 'all' || p.category === filter) ?? [];

  return (
    <main className="container">
      <section className="page-header">
        <h1>Products</h1>
        <p className="lead">Async data loading — LCP and CLS test scenario.</p>
      </section>

      <div className="test-info">
        <strong>What this tests:</strong>
        <ul>
          <li>LCP fires late — after the React state update renders the product grid.</li>
          <li>CLS may spike when spinner is replaced by the product grid.</li>
          <li>Filter interaction tests INP.</li>
        </ul>
      </div>

      {products === null ? (
        <div className="spinner-container" data-loading aria-live="polite">
          <div className="spinner" role="status" aria-label="Loading products…" />
          <p>Loading products…</p>
        </div>
      ) : (
        <>
          {filtersVisible && (
            <div className="filter-bar">
              {(['all', 'electronics', 'clothing', 'books'] as Category[]).map(cat => (
                <button
                  key={cat}
                  className={`filter-btn${filter === cat ? ' active' : ''}`}
                  onClick={() => setFilter(cat)}
                >
                  {cat === 'all' ? 'All' : `${CATEGORY_ICONS[cat]} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`}
                </button>
              ))}
            </div>
          )}

          <div className="products-grid" aria-live="polite">
            {visible.map(p => (
              <div key={p.id} className="product-card">
                <div className="product-thumb">{CATEGORY_ICONS[p.category]}</div>
                <div className="product-body">
                  <h3 className="product-name">{p.name}</h3>
                  <div className="product-meta">
                    <span className="product-rating">{stars(p.rating)}</span>
                    <span className="product-reviews">({p.reviews})</span>
                  </div>
                  <div className="product-footer">
                    <span className="product-price">${p.price.toFixed(2)}</span>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => addToCart(p.id)}
                      disabled={addedIds.has(p.id)}
                    >
                      {addedIds.has(p.id) ? '✓ Added' : 'Add to cart'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
