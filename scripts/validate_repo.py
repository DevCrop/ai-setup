"""Offline release integrity checks; does not call any model."""
import hashlib
import json
from pathlib import Path
import re
import tomllib

from setup import ROOT, read_json, safe, target_key
from index_docs import render


def main():
    for p in ROOT.rglob("*.json"):
        if ".git" not in p.parts:
            json.loads(p.read_text(encoding="utf-8"))
    for p in (ROOT / "global").rglob("*.toml"):
        tomllib.loads(p.read_text(encoding="utf-8"))
    manifest = read_json(ROOT / "manifest.json")
    if tomllib.loads((ROOT / 'global/config.base.toml').read_text(encoding='utf-8'))['agents'] != manifest['agent_settings']:
        raise ValueError('Config documentation differs from deployed manifest values')
    targets = set()
    for f in manifest["files"]:
        key = target_key(f)
        if key in targets:
            raise ValueError("Duplicate manifest target")
        targets.add(key)
        assert safe(ROOT, f["source"]).is_file()
    retired = set()
    for entry in manifest.get('retired', []):
        key = target_key(entry)
        safe(ROOT, entry['target'])
        assert key not in targets and key not in retired
        assert re.fullmatch('[0-9a-f]{64}', entry['sha256'])
        retired.add(key)
    policies = [f for f in manifest['files'] if f.get('kind') == 'invocation-policy']
    assert {f['target'] for f in policies} == {'skills/archify/agents/openai.yaml', 'skills/ponytail/agents/openai.yaml'}
    for f in policies:
        assert (ROOT / f['source']).read_text(encoding='utf-8').strip() == 'policy:\n  allow_implicit_invocation: false'
    for skill in read_json(ROOT / "versions.lock.json")["skills"]:
        folder = ROOT / "vendor" / skill["name"]
        actual = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in folder.rglob("*") if p.is_file()}
        assert actual == skill["files"], f'Upstream integrity mismatch: {skill["name"]}'
    rtk = read_json(ROOT / 'versions.lock.json')['tools']['rtk']
    assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', rtk['version'])
    for name, asset in rtk['assets'].items():
        assert re.fullmatch('[0-9a-f]{64}', asset['sha256'])
        assert asset['url'] == f'https://github.com/rtk-ai/rtk/releases/download/v{rtk["version"]}/{name}'
    sources = read_json(ROOT / "references/registry.json")["sources"]
    assert len({s["id"] for s in sources}) == len(sources)
    for source in sources:
        if source.get('snapshot'):
            snapshot = source['snapshot']
            path = safe(ROOT / 'references', snapshot['path'])
            if hashlib.sha256(path.read_bytes()).hexdigest() != snapshot['sha256']:
                raise ValueError('Source snapshot hash mismatch: ' + source['id'])
    if (ROOT / 'docs/index.md').read_bytes().replace(b'\r\n', b'\n') != render():
        raise ValueError('Documentation index is stale; run scripts/index_docs.py')
    receipt = read_json(ROOT / 'diagrams/global/codex-flow.receipt.json')
    for suffix, field in [('json', 'specification_sha256'), ('html', 'artifact_sha256')]:
        if hashlib.sha256((ROOT / f'diagrams/global/codex-flow.{suffix}').read_bytes()).hexdigest() != receipt[field]:
            raise ValueError('Flow receipt is stale: ' + suffix)
    for folder in ("global", "docs", "templates"):
        for p in (ROOT / folder).rglob("*.md"):
            text = p.read_text(encoding="utf-8")
            assert "\ufffd" not in text, f"Encoding replacement character: {p}"
            assert not re.search(r"[A-Za-z]:[\\/]Users[\\/]", text), f"Machine path: {p}"
            for target in re.findall(r'\]\(([^)]+)\)', text):
                if '://' in target or target.startswith('#'):
                    continue
                if not (p.parent / target.split('#')[0]).exists():
                    raise ValueError(f'Broken documentation link: {p.relative_to(ROOT)} -> {target}')
    skill_count = sum(f['target'].endswith('/SKILL.md') for f in manifest['files'])
    print(json.dumps({"status": "pass", "managed_files": len(targets), "references": len(sources), "skills": skill_count}))


if __name__ == "__main__":
    main()
