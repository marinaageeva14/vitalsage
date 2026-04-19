import { describe, it, expect } from 'vitest';
import { compilePattern, matchRoute } from '../../../src/routing/matcher.js';
import type { RouteConfig } from '@vitalsage/types';

// ─── compilePattern ──────────────────────────────────────────────────────────

describe('compilePattern — exact paths', () => {
  it('matches exact path', () => {
    expect(compilePattern('/about')('/about')).toBe(true);
  });

  it('does not match different path', () => {
    expect(compilePattern('/about')('/contact')).toBe(false);
  });

  it('matches root exactly', () => {
    expect(compilePattern('/')('/')).toBe(true);
  });

  it('does not match root against /about', () => {
    expect(compilePattern('/')('/about')).toBe(false);
  });

  it('matches nested exact path', () => {
    expect(compilePattern('/blog/intro')('/blog/intro')).toBe(true);
  });

  it('does not partially match', () => {
    expect(compilePattern('/blog')('/blog/post-1')).toBe(false);
  });
});

describe('compilePattern — trailing slash normalisation', () => {
  it('/about/ matches /about', () => {
    expect(compilePattern('/about/')('/about')).toBe(true);
  });

  it('/about matches /about/', () => {
    expect(compilePattern('/about')('/about/')).toBe(true);
  });

  it('root / is not stripped', () => {
    expect(compilePattern('/')('/')).toBe(true);
  });
});

describe('compilePattern — single-segment wildcard (*)', () => {
  it('/blog/* matches /blog/post-1', () => {
    expect(compilePattern('/blog/*')('/blog/post-1')).toBe(true);
  });

  it('/blog/* does not match /blog (no segment after slash)', () => {
    expect(compilePattern('/blog/*')('/blog')).toBe(false);
  });

  it('/blog/* does not match /blog/post-1/comments (two segments)', () => {
    expect(compilePattern('/blog/*')('/blog/post-1/comments')).toBe(false);
  });

  it('/* matches any single-segment path', () => {
    expect(compilePattern('/*')('/anything')).toBe(true);
  });

  it('/* does not match root /', () => {
    expect(compilePattern('/*')('/')).toBe(false);
  });

  it('/* does not match multi-segment /a/b', () => {
    expect(compilePattern('/*')('/a/b')).toBe(false);
  });
});

describe('compilePattern — deep wildcard (**)', () => {
  it('/admin/** matches /admin/users', () => {
    expect(compilePattern('/admin/**')('/admin/users')).toBe(true);
  });

  it('/admin/** matches /admin/users/profile', () => {
    expect(compilePattern('/admin/**')('/admin/users/profile')).toBe(true);
  });

  it('/admin/** matches /admin (zero depth)', () => {
    expect(compilePattern('/admin/**')('/admin')).toBe(true);
  });

  it('/** matches /', () => {
    expect(compilePattern('/**')('/')).toBe(true);
  });

  it('/** matches /anything', () => {
    expect(compilePattern('/**')('/anything')).toBe(true);
  });

  it('/** matches /a/b/c', () => {
    expect(compilePattern('/**')('/a/b/c')).toBe(true);
  });

  it('/blog/** matches /blog', () => {
    expect(compilePattern('/blog/**')('/blog')).toBe(true);
  });

  it('/blog/** matches /blog/post-1', () => {
    expect(compilePattern('/blog/**')('/blog/post-1')).toBe(true);
  });

  it('/shop/** does not match /shop-extra (prefix guard)', () => {
    expect(compilePattern('/shop/**')('/shop-extra')).toBe(false);
  });
});

describe('compilePattern — named params (:param)', () => {
  it('/post/:id matches /post/123', () => {
    expect(compilePattern('/post/:id')('/post/123')).toBe(true);
  });

  it('/post/:id matches /post/abc-def', () => {
    expect(compilePattern('/post/:id')('/post/abc-def')).toBe(true);
  });

  it('/post/:id does not match /post (missing param)', () => {
    expect(compilePattern('/post/:id')('/post')).toBe(false);
  });

  it('/post/:id does not match /post/123/edit (extra segment)', () => {
    expect(compilePattern('/post/:id')('/post/123/edit')).toBe(false);
  });

  it('/user/:id/settings matches /user/42/settings', () => {
    expect(compilePattern('/user/:id/settings')('/user/42/settings')).toBe(true);
  });

  it('/user/:id/settings does not match /user/42/other', () => {
    expect(compilePattern('/user/:id/settings')('/user/42/other')).toBe(false);
  });
});

describe('compilePattern — combined patterns', () => {
  it('/shop/:cat/** matches /shop/shoes/nike', () => {
    expect(compilePattern('/shop/:cat/**')('/shop/shoes/nike')).toBe(true);
  });

  it('/shop/:cat/** matches /shop/shoes (zero depth after param)', () => {
    expect(compilePattern('/shop/:cat/**')('/shop/shoes')).toBe(true);
  });

  it('/shop/:cat/* matches /shop/shoes/nike', () => {
    expect(compilePattern('/shop/:cat/*')('/shop/shoes/nike')).toBe(true);
  });

  it('/shop/:cat/* does not match /shop/shoes/nike/size-10', () => {
    expect(compilePattern('/shop/:cat/*')('/shop/shoes/nike/size-10')).toBe(false);
  });
});

describe('compilePattern — regex-special characters in path', () => {
  it('literal dots in pattern are treated as dots, not regex any', () => {
    expect(compilePattern('/v1.0/api')('/v1.0/api')).toBe(true);
    expect(compilePattern('/v1.0/api')('/v100/api')).toBe(false);
  });
});

// ─── matchRoute ──────────────────────────────────────────────────────────────

describe('matchRoute', () => {
  const routes: RouteConfig[] = [
    { pattern: '/',          label: 'Home' },
    { pattern: '/about',     label: 'About' },
    { pattern: '/blog/*',    label: 'Blog Post' },
    { pattern: '/blog/**',   label: 'Blog Catch-all' },
    { pattern: '/post/:id',  label: 'Post' },
    { pattern: '/admin/**',  label: 'Admin' },
  ];

  it('returns first matching route', () => {
    expect(matchRoute('/', routes)?.label).toBe('Home');
  });

  it('returns exact match over wildcard', () => {
    // /blog/* comes before /blog/** — should match first
    expect(matchRoute('/blog/post-1', routes)?.label).toBe('Blog Post');
  });

  it('strips query string before matching', () => {
    expect(matchRoute('/about?ref=twitter', routes)?.label).toBe('About');
  });

  it('normalises hash routing (#/path)', () => {
    expect(matchRoute('#/about', routes)?.label).toBe('About');
  });

  it('returns undefined when no route matches', () => {
    expect(matchRoute('/nowhere', routes)).toBeUndefined();
  });

  it('returns correct route for param path', () => {
    expect(matchRoute('/post/99', routes)?.label).toBe('Post');
  });

  it('returns undefined for empty routes array', () => {
    expect(matchRoute('/about', [])).toBeUndefined();
  });

  it('handles trailing slash in path', () => {
    expect(matchRoute('/about/', routes)?.label).toBe('About');
  });
});
