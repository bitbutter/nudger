import { describe, expect, it } from 'vitest';
import { parseHash, routeToHash } from '../lib/hashRoute';

describe('hash routing', () => {
  it('parses the document, files, templates and settings routes', () => {
    expect(parseHash('#/doc/abc%20123')).toEqual({ name: 'doc', id: 'abc 123' });
    expect(parseHash('#/files')).toEqual({ name: 'files' });
    expect(parseHash('#/templates')).toEqual({ name: 'templates' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/unknown')).toEqual({ name: 'home' });
  });

  it('does not crash on a malformed escape', () => {
    expect(parseHash('#/doc/%')).toEqual({ name: 'home' });
  });

  it('round-trips routes through hashes', () => {
    expect(routeToHash({ name: 'doc', id: 'a b' })).toBe('#/doc/a%20b');
    expect(parseHash(routeToHash({ name: 'doc', id: 'a b' }))).toEqual({ name: 'doc', id: 'a b' });
    expect(routeToHash({ name: 'settings' })).toBe('#/settings');
  });
});
