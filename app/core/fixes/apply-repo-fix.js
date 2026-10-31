import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { CoreError } from '../errors.js';
import { Fix } from '../fix.js';
import { maskHome } from '../mask-home.js';

// CommandRunner: (file, args, opts) -> Promise<{ code, stdout, stderr }>; never rejects.
export const execRunner = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : undefined, timeout: opts.timeout ?? 120000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || (err && typeof err.code === 'string' ? err.code : '')) });
  });
});

const sha = (s) => createHash('sha256').update(s).digest('hex');

// C1: runs `bash scripts/apply.sh` from the repo (repo -> live). It never opens a file under the Claude home itself.
export class ApplyRepoFix extends Fix {
  #repo;
  #runner;
  #homeDir;
  #claudeHome;

  // claudeHome: the folder the monitor reads; apply.sh writes there too (CLAUDE_CONFIG_DIR), so C1 and its fix agree.
  constructor({ id, repo, runner = execRunner, homeDir = os.homedir(), claudeHome = null }) {
    super(id);
    this.#repo = repo;
    this.#runner = runner;
    this.#homeDir = homeDir;
    this.#claudeHome = claudeHome;
  }

  // The only two commands this class can run.
  #run(dry) {
    const env = this.#claudeHome ? { CLAUDE_CONFIG_DIR: this.#claudeHome } : undefined;
    return this.#runner('bash', dry ? ['scripts/apply.sh', '--dry-run'] : ['scripts/apply.sh'], { cwd: this.#repo, env });
  }

  async #dryRun() {
    const r = await this.#run(true);
    if (r.code !== 0) throw new Error('dry run failed');
    return r.stdout;
  }

  async doPreview() {
    const out = await this.#dryRun();
    return { diff: out, previewId: sha(out) };
  }

  // Fix.apply has already re-run the dry run and compared its hash.
  async doApply() {
    const r = await this.#run(false);
    if (r.code !== 0) {
      // mask first: cutting first could leave half a home path that no longer matches
      const tail = maskHome(`${r.stdout}\n${r.stderr}`.trim(), this.#homeDir).slice(-400);
      throw new CoreError('APPLY_FAILED', { detail: tail });
    }
    return {};
  }
}
