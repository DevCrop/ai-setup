"""TTL cache with background refresh for slow sources (verify.sh, gh). One object holds all state, so tests can build their own."""
import threading, time


class TtlCache:
    def __init__(self):
        self._data = {}  # key -> (time, value)
        self._refreshing = set()
        self._lock = threading.Lock()

    def get(self, key, ttl, fn, slow=False, placeholder=None):
        """Return the cached value. A slow source refreshes in a thread, so a request never waits on it."""
        now = time.time()
        with self._lock:
            hit = self._data.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
            if slow:
                if key not in self._refreshing:
                    self._refreshing.add(key)
                    threading.Thread(target=self._refresh, args=(key, fn), daemon=True).start()
                return hit[1] if hit else placeholder
        return self._refresh(key, fn)

    def drop(self, key):
        with self._lock:
            self._data.pop(key, None)

    def _refresh(self, key, fn):
        try:
            val = fn()
            with self._lock:
                self._data[key] = (time.time(), val)
            return val
        finally:
            with self._lock:
                self._refreshing.discard(key)
