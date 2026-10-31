// The monitor iframe may load only the monitor html file, optionally with the ?v=<snapshot time> reload query.
const VERSION = /^\?v=[0-9A-Za-z%.:_-]{1,64}$/;

export function isFrameUrl(url, frameUrl) {
  if (typeof url !== 'string' || !frameUrl) return false;
  const bare = url.split('#')[0];
  if (bare === frameUrl) return true;
  return bare.startsWith(frameUrl) && VERSION.test(bare.slice(frameUrl.length));
}
