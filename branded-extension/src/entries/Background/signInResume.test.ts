import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleSignInTabUpdated,
  observeSignInNavigation,
  stopSignIn,
  watchSignIn,
} from './signInResume';

const origin = 'https://provider.example';
const callback = `${origin}/callback`;
const auth = (state = 'capture-state', redirect = callback) =>
  `https://login.example/authorize?response_type=code&state=${state}&redirect_uri=${encodeURIComponent(redirect)}`;
const completed = (state = 'capture-state') => `${callback}?code=unused-test-code&state=${state}`;
const navigation = (tabId: number, url: string, overrides: Partial<chrome.webRequest.WebRequestBodyDetails> = {}) =>
  observeSignInNavigation({ tabId, url, type: 'main_frame', frameId: 0, ...overrides } as chrome.webRequest.WebRequestBodyDetails);
const update = (url = `${origin}/home`, incognito = false, tabId = 2) =>
  handleSignInTabUpdated(tabId, { url }, { incognito } as chrome.tabs.Tab);

describe('cross-tab sign-in recovery', () => {
  const resume = vi.fn();
  beforeEach(() => {
    resume.mockClear();
    watchSignIn(1, { incognito: false, origins: [origin], resume });
  });
  afterEach(() => {
    [1, 2, 3, 4].forEach(stopSignIn);
  });

  it('resumes once after a matching callback moves on, including same-document navigation', () => {
    navigation(1, auth());
    navigation(2, completed());
    update(completed());
    expect(resume).not.toHaveBeenCalled();
    update();
    update();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it.each([
    auth() + '&state=other',
    auth() + '&redirect_uri=https%3A%2F%2Fprovider.example%2Fother',
    auth().replace('response_type=code', 'response_type=token'),
    auth().replace('state=capture-state', 'state='),
    auth('capture-state', 'http://provider.example/callback'),
    auth('capture-state', 'https://unlisted.example/callback'),
  ])('rejects malformed or undeclared authorization: %s', (url) => {
    navigation(1, url);
    navigation(2, completed());
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it.each([
    completed('different-state'),
    `${callback}?state=capture-state`,
    `${callback}?code=unused&state=capture-state&state=other`,
    `${origin}/other?state=capture-state&code=unused`,
    'https://unlisted.example/callback?state=capture-state&code=unused',
  ])('ignores a callback that cannot identify this capture: %s', (url) => {
    navigation(1, auth());
    navigation(2, url);
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'sub_frame', frameId: 1 },
    { type: 'xmlhttprequest', frameId: 0 },
    { type: 'main_frame', frameId: 0, documentLifecycle: 'prerender' },
  ])('does not learn authorization from background or prerendered requests: %j', (overrides) => {
    navigation(1, auth(), overrides as Partial<chrome.webRequest.WebRequestBodyDetails>);
    navigation(2, completed());
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not guess between captures with the same state and callback', () => {
    const otherResume = vi.fn();
    watchSignIn(3, { incognito: false, origins: [origin], resume: otherResume });
    navigation(1, auth());
    navigation(3, auth());
    navigation(2, completed());
    update();
    expect(resume).not.toHaveBeenCalled();
    expect(otherResume).not.toHaveBeenCalled();
  });

  it('does not cross normal and incognito contexts', () => {
    navigation(1, auth());
    navigation(2, completed());
    update(`${origin}/home`, true);
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it('does not resume when the callback leaves its declared origin', () => {
    navigation(1, auth());
    navigation(2, completed());
    navigation(2, 'https://unlisted.example/home');
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it('drops an old authorization after a malformed new attempt', () => {
    navigation(1, auth());
    navigation(1, auth() + '&state=other');
    navigation(2, completed());
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it('clears correlation when the callback tab closes', () => {
    navigation(1, auth());
    navigation(2, completed());
    stopSignIn(2);
    update();
    expect(resume).not.toHaveBeenCalled();
  });

  it('allows a new sign-in after a consumed attempt', () => {
    navigation(1, auth());
    navigation(2, completed());
    update();
    navigation(1, auth('next-state'));
    navigation(2, completed('next-state'));
    update();
    expect(resume).toHaveBeenCalledTimes(2);
  });
});
