# TRACE Setup

This is the `codex/` folder of [DevCrop/ai-setup](https://github.com/DevCrop/ai-setup). Get it with `git clone https://github.com/DevCrop/ai-setup` and run the commands below from `ai-setup/codex`; `python scripts/bootstrap.py check` in ai-setup finds it there.

Portable Codex personal instructions, optional profiles, pinned Ponytail, RTK and ownership-based deployment. Python 3.11+ and Git are required. Use ChatGPT subscription login on each host. No API key is required.

Versions are fixed (2026-10-16 decision). Codex CLI is pinned to the stable `0.162.1` in `versions.lock.json` (`codex_cli_reviewed`), and the config sets `check_for_update_on_startup = false` so the CLI does not check for updates on startup. Nothing here detects new releases. An upgrade is a reviewed PR that changes the pin, followed by a reset.

Follow the Korean [detailed Windows installation guide](docs/install-another-windows-pc.md) for missing dependencies and folders, project packages and login. Portable report UI sources are in [templates/reports](templates/reports/README.md).

The opt-in [RTK live viewer](docs/rtk-live-dashboard.md) provides local read-only aggregate polling, visible-tab refresh, pause/error states and a Windows launcher. It does not install a startup task, hook or public web service.

Bundled skills go to `~/.agents/skills`. `verify` fails and names any `config.toml` `profiles.<name>` entry that clashes with a TRACE-managed profile, without editing it. Spawned agents default to GPT-6.1 Sol medium. The `explorer` custom agent runs on GPT-6.1 Sol high ([decision 004](docs/decisions/004-subagent-models.md)). Its read-only behaviour comes from its instructions only: a custom agent file cannot set `sandbox_mode`, so children inherit the parent's sandbox.

## Install

Clone this repository anywhere, including paths with spaces and non-Latin names. Run these commands from the checkout, or invoke the script by absolute path:

```text
python -B scripts/setup.py plan
python -B scripts/setup.py apply
python -B scripts/setup.py verify
```

For reviewed pre-existing personal instructions/profiles, inspect `plan --adopt-existing` then use `apply --adopt-existing` once. This flag never overrides a modified file already owned by TRACE. `--home` and `CODEX_HOME` select Codex home; `--state` selects local deployment state. Defaults use supported per-user locations, not drive letters. `--personal-skills` selects the separate personal skill root (default `~/.agents/skills`); CODEX_HOME does not relocate it. For isolated checks, set `--home`, `--personal-skills`, and `--state` to disposable locations together. Keep the same roots for plan/apply/verify/rollback. Overlapping Codex home and personal skill roots are refused.

The complete reviewed upstream Ponytail package is bundled in `vendor/` and managed by the same manifest for offline installation, removal, and rollback. It retains upstream instructions unchanged; the global working agreement limits applicability. TRACE adds only `agents/openai.yaml` with implicit invocation disabled for this skill. Invoke `$ponytail` explicitly (or select the skill in the app). `setup.py` is the sole install/update/verify/remove entry point, including skills.

The personal `computer-use-workflow` skill is deployed to the supported user skill root (`~/.agents/skills`, or `--personal-skills`). It follows the available official Computer Use runtime and keeps browser/native execution evidence separate. It is a TRACE-authored workflow, not an OpenAI-published plugin. See [Computer Use maintenance](docs/computer-use-maintenance.md).

See [Ponytail usage examples](docs/skill-usage.md) for explicit selection, task scope, intensity and completion criteria. The English personalization source is [global/AGENTS.md](global/AGENTS.md); do not maintain a second edited copy.

## Lifecycle

```text
python -B scripts/setup.py rollback
python -B scripts/setup.py recover
python -B scripts/setup.py uninstall
python -B scripts/setup.py doctor --codex <executable-path>
```

`recover` handles a pending interrupted transaction. A single prior restore point lives in private machine-local state, never in Git. Config restoration refuses conflicting edits. Unmanaged files and credentials are not deleted. Close competing setup processes before applying. A new session is needed to inspect effective instructions; filesystem verification is not proof of app UI or model behavior.

Choose models in the app. Optional CLI commands: `codex --profile sol`, `codex --profile astra`, `codex --profile astra-deep`. Profiles do not change the persistent base model selection and do not implement automatic model switching. The sol preset selects GPT-6.1 Sol Medium; existing app/base effort choices are preserved.

## Optional RTK and project maintenance

```text
python -B scripts/tools.py install-rtk
python -B scripts/tools.py verify
python -B scripts/tools.py run git status
python -B scripts/project_cleanup.py register --id NAME --path PATH --auto
python -B scripts/project_cleanup.py scan
```

RTK uses pinned, SHA-256-verified platform assets in private host state; no hook, PATH edit, model/API call or per-project installation is required. The managed `bin/trace_rtk.py` in Codex home can run from any project by absolute path. RTK is third-party; compressed output bytes do not prove OpenAI tokens or subscription savings. Use raw project-native commands for final acceptance. See [operations](docs/operations.md) and [official versus local policy](docs/decisions/002-maintenance-and-rtk.md).

Dependency cleanup (`project_cleanup.py`) runs only on a registered project after 45 observed idle days, with locked/ignored dependencies, certain process checks and no links or tracked content. Unknown or active projects are retained. Use `project_cleanup.py hold --id NAME` or `touch --id NAME` to retain or mark active work. Only the exact allowlisted dependency directory is removable. It runs only when you invoke it; no scheduler calls it.

## Project adoption

Start with [the project authoring contract](templates/project/README.md). Reuse existing rule documents; do not blindly copy the template into an existing repo. This setup does not install product-project rules.

## Checks

```text
python -B -m unittest discover -s scripts -p 'test_*.py' -v
python -B scripts/validate_repo.py
python -B scripts/index_docs.py
```

See [documentation index](docs/index.md) and [operations](docs/operations.md). Nothing in this repository is scheduled: no automation, heartbeat or routine is created or read.

## Other computers and existing hosts

Install from the reviewed `main` commit and record it. On an existing TRACE host, review `plan` before `apply`. Do not copy an entire Codex home between computers; authenticate independently and preserve local model, MCP, permissions and app state.

The installer reads older ownership records and removes the `retired` entries in `manifest.json` (such as `encoding-safety/SKILL.md` and `official-source-workflow/SKILL.md` under the personal skill root) only when their bytes match exactly. Modified copies conflict even with `--adopt-existing`. Only empty parents of removed files are pruned. One local restore point contains their prior bytes; credentials and raw backups must never be committed. `doctor` reports additional personal skills, which can make another computer's effective context differ. Whole-home cleanup remains separate.

`doctor` and `verify.unmanaged_skill_findings` also report directories missing `SKILL.md`. These findings are review candidates, not permission to delete user files. A managed-file verification pass does not mean that the entire Codex home is clean.
