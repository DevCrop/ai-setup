"""TTL cache with background refresh for slow sources (verify.sh, gh). One object holds all state, so tests can build their own.

- A slow source refreshes in a thread, so a request never waits on it.
- A normal source is single-flight: concurrent requests for the same key wait for one computation instead of each spawning git/gh.
- A source that raises keeps serving its last good value (or the placeholder) for one ttl, so a broken source is retried once per ttl,
  not on every poll, and one failure is printed once."""
import sys, threading, time

_MISSING = object()
FAIL_WINDOW = 2.0  # seconds during which a failed normal source is not run again


class TtlCache:
    def __init__(self):
        self._data = {}  # key -> (time, value)
        self._refreshing = set()
        self._key_locks = {}
        self._failed = {}  # key -> (time, exception) of the last failure of a normal source
        self._lock = threading.Lock()

    def get(self, key, ttl, fn, slow=False, placeholder=None):
        now = time.time()
        with self._lock:
            hit = self._data.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
            if slow:
                if key not in self._refreshing:
                    self._refreshing.add(key)
                    fallback = hit[1] if hit else placeholder
                    try:
                        threading.Thread(target=self._refresh, args=(key, fn, fallback), daemon=True).start()
                    except RuntimeError:  # no thread available: try again on the next call, serve what we have
                        self._refreshing.discard(key)
                return hit[1] if hit else placeholder
            klock = self._key_locks.setdefault(key, threading.Lock())
        with klock:  # single flight: whoever got here second reuses the value the first one just stored
            with self._lock:
                hit = self._data.get(key)
                if hit and time.time() - hit[0] < ttl:
                    return hit[1]
                failed = self._failed.get(key)
                if failed and time.time() - failed[0] < FAIL_WINDOW:
                    raise failed[1]  # callers that queued behind a failure get the same error, not N more slow failures
            return self._refresh(key, fn)

    def drop(self, key):
        with self._lock:
            self._data.pop(key, None)

    def _refresh(self, key, fn, fallback=_MISSING):
        try:
            val = fn()
        except Exception as e:
            if fallback is _MISSING:
                with self._lock:
                    self._failed[key] = (time.time(), e)
                raise  # a normal source: the caller sees the error
            print(f"dashboard: refresh of '{key}' failed: {type(e).__name__}", file=sys.stderr)
            val = fallback  # a slow source: serve the last good value for one ttl
        finally:
            with self._lock:
                self._refreshing.discard(key)
        with self._lock:
            self._data[key] = (time.time(), val)
            self._failed.pop(key, None)
        return val
