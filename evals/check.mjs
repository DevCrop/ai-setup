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
const nodeTest = () => spawnSync(process.execPath, ['--test', 'server/**/*.test.mjs'], { cwd: dir, encoding: 'utf8', timeout: 60000 }).status === 0;
const registered = (part) => /@(use|forward|import)\s+['"][^'"]*/.test(read('scss/main.scss')) && new RegExp(`@(use|forward|import)\\s+['"][^'"]*${part}`).test(read('scss/main.scss'));
const newScss = (folder) => files.filter((f) => f.startsWith(`scss/${folder}/`) && !/_button|_header|_reset|_variables/.test(f));
// SQL built from a template literal or string concatenation on one line
const sqlBuilt = any(/^server\/.*\.m?js$/, /^(?=.*\b(SELECT|INSERT|UPDATE|DELETE)\b)(?=.*(\$\{|['"]\s*\+\s*\w)).*$/im);

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
    ['accordion TS is a class', any(/^ts\/.*ccordion.*\.ts$/i, /class\s+\w+/)],
    ['class has init and destroy', any(/^ts\/.*ccordion.*\.ts$/i, /\binit\s*\(/) && any(/^ts\/.*ccordion.*\.ts$/i, /\bdestroy\s*\(/)],
    ['aria-expanded used', /aria-expanded/.test(read('index.html')) || any(/^ts\/.*\.ts$/, /aria-expanded/)],
    ['triggers are buttons', /<button[^>]*aria-(expanded|controls)/.test(read('index.html'))],
    ['accordion SCSS in components/', newScss('components').some((f) => /ccordion|faq/i.test(f))],
    ['accordion SCSS registered', registered('ccordion') || registered('faq')],
  ],
  'rest-db': [
    ['idempotency key handled', any(/^server\/.*\.m?js$/, /idempoten/i)],
    ['unique constraint on the key', any(/^server\/.*\.m?js$/, /UNIQUE/i)],
    ['no SQL built from strings', !sqlBuilt],
    ['duplicate-request test exists', any(/^server\/.*test.*\.m?js$/, /idempoten|twice|duplicate|두 번|중복/i)],
    ['node --test server/**/*.test.mjs passes', nodeTest()],
    ['a subagent reviewed or helped (Agent call)', agents.length > 0],
  ],
  'dashboard-cors': [
    ['dashboard.html with data-* hooks', /data-[a-z]/.test(read('dashboard.html'))],
    ['stats endpoint exists', any(/^server\/.*\.m?js$/, /\/api\/stats/)],
    ['CORS allows localhost:5173', any(/^server\/.*\.m?js$/, /localhost:5173/)],
    ['no wildcard origin', !any(/^server\/.*\.m?js$/, /Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/)],
    ['node --test server/**/*.test.mjs passes', nodeTest()],
    ['two or more subagents ran', agents.length >= 2],
  ],
  bugfix: [
    ['total uses quantity', (() => { const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const m=await import('./server/cart.mjs');console.log(m.total([{price:100,qty:3},{price:50,qty:2}]))"], { cwd: dir, encoding: 'utf8' }); return r.stdout.trim() === '400'; })()],
    ['regression test mentions qty', any(/^server\/.*test.*\.m?js$/, /qty|quantity|수량/i)],
    ['node --test server/**/*.test.mjs passes', nodeTest()],
    ['only cart files changed', !files.some((f) => /^(index\.html|scss\/|ts\/)/.test(f) && spawnSync('git', ['diff', '--quiet', 'HEAD', '--', f], { cwd: dir }).status === 1)],
  ],
}[name];

if (!checks) { console.log(`unknown case: ${name}`); process.exit(2); }
let ok = 0;
for (const [label, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${label}`); if (pass) ok++; }
console.log(`INFO  ${name}: agents=${agents.join(',') || 'none'}`);
console.log(`score ${ok}/${checks.length}`);
