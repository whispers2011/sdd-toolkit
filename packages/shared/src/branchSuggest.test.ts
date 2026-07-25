import { describe, expect, it } from 'vitest';
import { isValidBranchName, suggestBranchName } from './branchSuggest.js';

describe('suggestBranchName', () => {
  it('schlägt integration/<slug> vor', () => {
    expect(suggestBranchName('Review-Portal & Agents', [])).toBe('integration/review-portal-agents');
    expect(suggestBranchName('Übergrößen-Test', [])).toBe('integration/uebergroessen-test');
  });

  it('weicht bei Kollision auf -2, -3 … aus', () => {
    const existing = ['integration/foo', 'integration/foo-2'];
    expect(suggestBranchName('foo', existing)).toBe('integration/foo-3');
  });

  it('fällt bei leerem Slug auf "feature" zurück', () => {
    expect(suggestBranchName('!!!', [])).toBe('integration/feature');
  });
});

describe('isValidBranchName', () => {
  it('akzeptiert übliche Branch-Namen', () => {
    for (const name of ['main', 'integration/foo-2', 'release/v1.2.3', 'a/b/c']) {
      expect(isValidBranchName(name), name).toBe(true);
    }
  });

  it('lehnt git-verbotene Konstrukte ab', () => {
    const bad = [
      '',
      '-lead',
      '/lead',
      'trail/',
      'end.',
      'x.lock',
      'a..b',
      'a//b',
      '@',
      'a@{b',
      'mit space',
      'tab\tname',
      'stern*',
      'frage?',
      'klammer[',
      'tilde~',
      'caret^',
      'colon:',
      'back\\slash',
      'a/.hidden',
      'sub/x.lock',
    ];
    for (const name of bad) {
      expect(isValidBranchName(name), JSON.stringify(name)).toBe(false);
    }
  });
});
