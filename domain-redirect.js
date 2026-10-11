/* Load only in the GitHub Pages index, after new-domain Google login is verified. */
if (location.hostname === 'ubriga.github.io' && /^\/brigagame(?:\/|$)/.test(location.pathname)) {
  const path = location.pathname.replace(/^\/brigagame(?=\/|$)/, '') || '/';
  location.replace('https://brigagame.brigastudio.com' + path + location.search + location.hash);
}
