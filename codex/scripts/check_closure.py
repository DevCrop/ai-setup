"""Read-only maintenance completion checks; no upgrades, model calls or publishing."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys

from setup import ROOT, Deployment, read_json, save_json


def collect_release(root=ROOT):
    """Use the checkout's existing remote, never search projects or drives."""
    gh = shutil.which('gh')
    if not gh:
        return {'status': 'unknown', 'reason': 'GitHub CLI unavailable'}
    try:
        proc = subprocess.run([gh, 'release', 'view', '--json', 'tagName,publishedAt,url,assets'],
                              cwd=root, capture_output=True, text=True, timeout=30)
        if proc.returncode:
            return {'status': 'unknown', 'reason': 'Latest release collection failed'}
        release = json.loads(proc.stdout)
        tag = 'refs/tags/' + release['tagName']
        refs = subprocess.run(['git', 'ls-remote', '--tags', 'origin', tag, tag + '^{}'],
                              cwd=root, capture_output=True, text=True, timeout=30)
        if refs.returncode:
            return {'status': 'unknown', 'reason': 'Release tag collection failed'}
        ids = dict(line.split()[::-1] for line in refs.stdout.splitlines() if len(line.split()) == 2)
        commit = ids.get(tag + '^{}', ids.get(tag))
        if not commit:
            return {'status': 'unknown', 'reason': 'Release tag unavailable'}
        return {'status': 'collected', **release, 'tag_commit': commit}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {'status': 'unknown', 'reason': 'Latest release collection failed'}


def evaluate(manifest, lock, installed, tools, release, registrations, routine):
    findings = {}

    def add(key, evidence, action, validation, status='attention'):
        findings[key] = {'status': status, 'evidence': evidence,
                         'proposed_action': action, 'validation': validation}

    wanted = manifest['version']
    actual = installed.get('version')
    if actual != wanted:
        add('deployment-version', {'checkout': wanted, 'installed': actual},
            'Review the managed plan and approved migration; missing state is unknown.',
            'Apply only approved owned files, then verify and check repeat application.')
    if release.get('status') != 'collected':
        add('publication-unknown', {'reason': release.get('reason', 'Unavailable')},
            'Restore read-only GitHub access; do not infer publication success.',
            'Collect the current release and verify tag/artifact identity.', 'unknown')
    elif release.get('tagName') != 'v' + wanted:
        add('publication-version', {'checkout': wanted, 'released': release.get('tagName')},
            'Inspect the existing PR, final-head CI, release and deployment separately; publish only with approval.',
            'Verify merged commit, immutable tag and release artifact through a clean install.')
    if tools.get('rtk', {}).get('version') != lock['tools']['rtk']['version']:
        add('rtk-version', {'reviewed': lock['tools']['rtk']['version'],
                            'installed': tools.get('rtk', {}).get('version')},
            'Optional RTK is missing or differs; review the exact release and apply only within recorded host authorization.',
            'Verify checksum/ownership and relevant native runtime checks after approved installation.')
    projects = routine.get('projects', {})
    for key in registrations.get('projects', {}):
        reviewed = projects.get(key, {})
        if not reviewed.get('last_substantive_review'):
            add('project-initial-review:' + key, {'project': key, 'baseline_only': True},
                'Perform one scoped initial instruction/configuration/acceptance-contract review, even if the fingerprint is unchanged.',
                'Record the inspected HEAD/content fingerprint and limits; baseline collection is not semantic acceptance.')
    return findings


def evaluate_integrity(health, release, receipt):
    """Version equality never substitutes for actual file or published-asset evidence."""
    findings = {}
    if health.get('status') != 'pass':
        findings['managed-integrity'] = {
            'status': 'unknown' if health.get('status') == 'unknown' else 'attention',
            'evidence': {'status': health.get('status'), 'errors': health.get('errors', [])},
            'proposed_action': 'Inspect ownership and user edits; repair only within recorded authorization.',
            'validation': 'Exact manifest assets, config keys and retired targets must verify.'}
    if release.get('status') == 'collected':
        digest = next(((a.get('digest') or '').removeprefix('sha256:') for a in release.get('assets', [])
                       if a.get('name') == 'codex-setup-' + release['tagName'] + '.zip'), None)
        if (receipt.get('status') != 'pass' or receipt.get('tag') != release['tagName'] or
                receipt.get('commit') != release.get('tag_commit') or
                not digest or receipt.get('zip_sha256') != digest):
            findings['release-artifact-evidence'] = {
                'status': 'attention',
                'evidence': {'published_tag': release['tagName'], 'tag_commit': release.get('tag_commit'),
                             'recorded_tag': receipt.get('tag'), 'asset_digest_matches': bool(digest and receipt.get('zip_sha256') == digest)},
                'proposed_action': 'Download and hash the exact current published ZIP; verify in disposable roots, never the real home.',
                'validation': 'Bind tag/commit/digest to clean install, repeat, migration/removal and restore evidence.'}
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path)
    args = parser.parse_args()
    try:
        state = args.state or Deployment().state
        manifest = read_json(ROOT / 'manifest.json')
        lock = read_json(ROOT / 'versions.lock.json')
        installed = read_json(state / 'installed.json', {})
        tools = read_json(state / 'tools-installed.json', {})
        # A missing project registry is an empty scope, not discovery permission.
        registrations = read_json(state / 'cleanup-projects.json', {})
        routine = read_json(state / 'routine-review.json', {})
        release = collect_release()
        findings = evaluate(manifest, lock, installed, tools, release, registrations, routine)
        try:
            health = Deployment(state=state).verify()
        except (OSError, ValueError, KeyError):
            health = {'status': 'unknown', 'errors': ['Managed integrity collection failed']}
        findings.update(evaluate_integrity(health, release, read_json(state / 'release-verification.json', {})))
        cli = shutil.which('codex')
        cli_status = 'unknown'
        if cli:
            proc = subprocess.run([cli, '--version'], capture_output=True, text=True, timeout=15)
            cli_status = proc.stdout.strip() if proc.returncode == 0 else 'unknown'
        expected = 'codex-cli ' + lock['runtime']['codex_cli_reviewed']
        if cli_status != expected:
            findings['cli-version'] = {'status': 'unknown' if cli_status == 'unknown' else 'attention',
                'evidence': {'reviewed': expected, 'installed': cli_status},
                'proposed_action': 'Review host CLI availability/version; preserve host choice and apply only within recorded host authorization.',
                'validation': 'Exact CLI version, subscription status and targeted startup/configuration checks.'}
        report = {'checked_at': datetime.now(timezone.utc).isoformat(),
                  'status': 'attention' if findings else 'pass',
                  'release': release, 'cli': cli_status, 'managed_integrity': health, 'findings': findings,
                  'limit': 'Read-only inspection; artifact receipt must match the current tag/commit/digest. No policy edits, upgrades or publication; does not prove desktop/model behavior.'}
        save_json(state / 'closure-report.json', report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if any(v['status'] == 'unknown' for v in findings.values()) else 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(type(exc).__name__ + ': maintenance collection failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
