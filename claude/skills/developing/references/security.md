# Security baseline: examples and checks

## CORS allowlist (Express)

```js
const ALLOWED = new Set(['https://www.example.co.kr', 'https://admin.example.co.kr']);
app.use((req, res, next) => {
  const origin = req.get('Origin');
  res.vary('Origin');  // always, so a cache never serves one origin's answer to another
  if (origin && ALLOWED.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && ALLOWED.has(origin) ? 204 : 403);
  next();
});
```

Bad: `res.set('Access-Control-Allow-Origin', req.get('Origin'))` or `*` with `Allow-Credentials: true`.

## Parameterized SQL

```python
cur.execute("SELECT id, name FROM products WHERE name LIKE ?", (f"%{q}%",))   # good
cur.execute(f"SELECT id, name FROM products WHERE name LIKE '%{q}%'")          # bad
```

## Passwords

`argon2-cffi` (`PasswordHasher().hash(pw)`), `bcrypt`, or the framework's built-in hasher. Never MD5, SHA-1 or unsalted SHA-256.

## Curl checks

Set `BASE` to the local server, for example `BASE=http://localhost:8000`.

```bash
# allowed origin: 204 and Access-Control-Allow-Origin equal to the origin
curl -i -X OPTIONS -H "Origin: https://www.example.co.kr" -H "Access-Control-Request-Method: POST" "$BASE/api/items"
# blocked origin: no Access-Control-Allow-Origin header (403 or a response without it)
curl -i -X OPTIONS -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST" "$BASE/api/items"
# SQL injection probe: 4xx or an empty list, never all rows or a 500 with SQL in the body
curl -i "$BASE/api/products?q=%27%20OR%20%271%27%3D%271"
# auth: missing and invalid token both return 401
curl -i "$BASE/api/me"
curl -i -H "Authorization: Bearer invalid" "$BASE/api/me"
```

## Production error body

```json
{ "error": "internal_error", "requestId": "c0a8..." }
```

The stack trace goes to the server log with the same `requestId`, never to the client.
