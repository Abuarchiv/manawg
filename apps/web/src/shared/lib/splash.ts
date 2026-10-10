export const SPLASH_DURATION_MS = 1400;
export const SPLASH_FADE_MS = 200;
export const SPLASH_STORAGE_KEY = 'manawg:splash-shown';
/** Opt-in for screenshot runs: shows the splash even under automation. */
export const SPLASH_DEMO_KEY = 'manawg:splash-demo';

/**
 * Runs before first paint: the splash shows once per tab/PWA window. Automated browsers
 * (navigator.webdriver, e.g. Playwright e2e) skip it unless the demo key is set.
 */
export const SPLASH_BOOTSTRAP_SCRIPT = `(function(){try{var s=sessionStorage;var skip=s.getItem('${SPLASH_STORAGE_KEY}')||(navigator.webdriver&&!s.getItem('${SPLASH_DEMO_KEY}'));s.setItem('${SPLASH_STORAGE_KEY}','1');if(skip)document.documentElement.dataset.splash='off';}catch(e){}})();`;
