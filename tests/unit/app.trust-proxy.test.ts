/**
 * Railway always fronts the app with an edge proxy. Without trust proxy,
 * req.ip is the proxy hop for every client, so the in-memory rate limiters
 * share ONE bucket across all merchants' customers — 10 junk checkout posts
 * a minute would 429 every merchant's checkout platform-wide.
 */

jest.mock('../../src/routes', () => ({ __esModule: true, default: require('express').Router() }));

import { createApp } from '../../src/app';

describe('app proxy configuration', () => {
  it('trusts the platform edge proxy hop so req.ip is the real client address', () => {
    const app = createApp();
    expect(app.get('trust proxy')).toBe(1);
  });
});
