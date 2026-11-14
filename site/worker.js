// The ScanRift website is static files; this script only sends every other hostname
// (www.scanrift.lol, the workers.dev address) and plain http to the one canonical
// https address with a permanent redirect, so search engines index a single copy of
// each page.
const CANONICAL_HOST = 'scanrift.lol';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== CANONICAL_HOST || url.protocol !== 'https:') {
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
