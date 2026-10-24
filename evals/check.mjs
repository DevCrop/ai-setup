// Deterministic grader for one eval run: node evals/check.mjs <case> <project-dir> <stream.jsonl>
// Prints PASS/FAIL lines and a final "score <passed>/<total>". Exit code is always 0 (a score, not a gate).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , name, dir, jsonl] = process.argv;
const read = (p) => { try { return readFileSync(join(dir, p), 'utf8'); } catch { return ''; } };
const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    if (f === 'node_modules' || f === '.git' || f === '.claude') continue;
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(relative(dir, p).replace(/\\/g, '/'));
  }
  return out;
};
const files = walk(dir);
const all = (re) => files.filter((f) => re.test(f)).map((f) => [f, read(f)]);
const any = (re, body) => all(re).some(([, s]) => body.test(s));

// Agent calls made by the main thread (subagent_type per call)
const agents = [];
for (const line of (existsSync(jsonl) ? readFileSync(jsonl, 'utf8') : '').split('\n')) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.type !== 'assistant' || e.parent_tool_use_id || typeof e.message !== 'object') continue;
  for (const c of e.message.content || []) if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) agents.push(c.input?.subagent_type || 'general-purpose');
}
// List test files explicitly: Node 20 does not expand globs in --test, and a bare --test would search the whole fixture.
const tests = files.filter((f) => /^server\/(.*\/)?[^/]*\.test\.mjs$/.test(f));
const nodeTest = () => tests.length > 0 && spawnSync(process.execPath, ['--test', ...tests], { cwd: dir, encoding: 'utf8', timeout: 60000 }).status === 0;
const registered = (part) => /@(use|forward|import)\s+['"][^'"]*/.test(read('scss/main.scss')) && new RegExp(`@(use|forward|import)\\s+['"][^'"]*${part}`).test(read('scss/main.scss'));
const newScss = (folder) => files.filter((f) => f.startsWith(`scss/${folder}/`) && !/_button|_header|_reset|_variables/.test(f));
// SQL built from a template literal or string concatenation on one line (upper-case SQL shapes only, so test titles do not count)
const sqlBuilt = any(/^server\/.*\.m?js$/, /^(?=.*(INSERT INTO|DELETE FROM|UPDATE \w+ SET|SELECT\b.*\bFROM\b))(?=.*(\$\{|['"]\s*\+\s*\w)).*$/m);
const keyWord = /idempoten\w*|request_?id|dedup\w*/i;
// a uniqueness rule on the dedup key, on the same line as the key's name
const uniqueKey = any(/^server\/.*\.m?js$/, /^.*(idempoten\w*|request_?id|dedup\w*)[^\n]*\b(UNIQUE|PRIMARY KEY)\b|\bUNIQUE\b[^\n]*\([^)]*(idempoten|request_?id|dedup)/im);
const changed = (spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const accTs = /^ts\/.*(ccordion|faq).*\.ts$/i;

const checks = {
  'publish-landing': [
    ['one h1 in index.html', (read('index.html').match(/<h1[\s>]/g) || []).length === 1],
    ['no inline style attributes', !/\sstyle=/.test(read('index.html'))],
    ['landmarks main and section used', /<main[\s>]/.test(read('index.html')) && /<section[\s>]/.test(read('index.html'))],
    ['new SCSS in components/ or layouts/', newScss('components').length + newScss('layouts').length > 0],
    ['new SCSS registered in main.scss', [...newScss('components'), ...newScss('layouts')].some((f) => registered(f.split('/').pop().replace(/^_|\.scss$/g, '')))],
    ['colors come from abstracts variables', ![...newScss('components'), ...newScss('layouts')].some((f) => /#[0-9a-f]{3,6}\b/i.test(read(f)))],
  ],
  accordion: [
    ['accordion TS is a class', any(accTs, /class\s+\w+/)],
    ['class has init and destroy', any(accTs, /\binit\s*\(/) && any(accTs, /\bdestroy\s*\(/)],
    ['aria-expanded used', /aria-expanded/.test(read('index.html')) || any(/^ts\/.*\.ts$/, /aria-expanded/)],
    ['triggers are buttons', /<button[\s>]/.test(read('index.html'))],
    ['accordion SCSS in components/', newScss('components').some((f) => /ccordion|faq/i.test(f))],
    ['accordion SCSS registered', registered('ccordion') || registered('faq')],
  ],
  'rest-db': [
    ['dedup key handled', any(/^server\/.*\.m?js$/, keyWord)],
    ['unique constraint on the key', uniqueKey],
    ['no SQL built from strings', !sqlBuilt],
    ['duplicate-request test exists', any(/^server\/.*test.*\.m?js$/, /idempoten|twice|duplicate|두 번|중복/i)],
    ['server tests pass', nodeTest()],
    ['a subagent reviewed or helped (Agent call)', agents.length > 0],
  ],
  'dashboard-cors': [
    ['dashboard.html with data-* hooks', /data-[a-z]/.test(read('dashboard.html'))],
    ['stats endpoint exists', any(/^server\/.*\.m?js$/, /\/api\/stats/)],
    ['CORS allows localhost:5173', any(/^server\/.*\.m?js$/, /localhost:5173/)],
    ['no wildcard origin', !any(/^server\/.*\.m?js$/, /Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/)],
    ['server tests pass', nodeTest()],
    ['two or more subagents ran', agents.length >= 2],
  ],
  bugfix: [
    ['total uses quantity', (() => { const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const m=await import('./server/cart.mjs');console.log(m.total([{price:100,qty:3},{price:50,qty:2}]))"], { cwd: dir, encoding: 'utf8' }); return (r.stdout || '').trim() === '400'; })()],
    ['regression test mentions qty', any(/^server\/.*test.*\.m?js$/, /qty|quantity|수량/i)],
    ['server tests pass', nodeTest()],
    ['only cart files changed', changed.length > 0 && changed.every((f) => /^server\/cart[^/]*$/.test(f))],
  ],
}[name];

if (!checks) { console.log(`unknown case: ${name}`); process.exit(2); }
let ok = 0;
const ran = existsSync(join(dir, '.git'));  // a missing run dir scores 0, not the vacuous passes of negative checks
for (const [label, p] of checks) { const pass = ran && p; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${label}`); if (pass) ok++; }
console.log(`INFO  ${name}: agents=${agents.join(',') || 'none'}`);
console.log(`score ${ok}/${checks.length}`);
