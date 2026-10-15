import base64
import json
import os
from pathlib import Path
import tempfile
import tomllib
import unittest

from setup import Deployment, digest, patch_agents, safe, save_json


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="trace-test-")
        self.root = Path(self.tmp.name)
        self.source = self.root / "source 한글"
        self.source.mkdir()
        self.home = self.root / "home with spaces"
        self.state = self.root / "state"
        (self.source / "rules.md").write_text("new rules\n", encoding="utf-8")
        self.manifest = {"version": "1", "files": [{"source": "rules.md", "target": "AGENTS.md"}],
                         "agent_settings": {"enabled": True, "max_concurrent_threads_per_session": 2}}
        self.write_manifest()

    def tearDown(self):
        self.tmp.cleanup()

    def write_manifest(self):
        save_json(self.source / "manifest.json", self.manifest)

    def dep(self):
        return Deployment(self.source, self.home, self.state, self.root / 'personal skills')

    def bundled_skill_upgrade(self, installed=True):
        entries = []
        for name in ("sample", "ponytail"):
            for relative, data in (("SKILL.md", b"bundled skill\n"),
                                   ("agents/openai.yaml", b"policy:\n  allow_implicit_invocation: false\n")):
                source = f"{name}-{relative.replace('/', '-')}"
                (self.source / source).write_bytes(data)
                entries.append({"source": source, "target": f"skills/{name}/{relative}"})
        self.manifest["version"] = "1.3.1"
        self.manifest["files"].extend(entries)
        self.write_manifest()
        if installed:
            self.dep().apply()
        self.manifest["version"] = "1.3.2"
        self.manifest["retired"] = [
            {"target": e["target"], "sha256": digest((self.source / e["source"]).read_bytes()),
             "owned_only": True} for e in entries]
        for entry in entries:
            entry["root"] = "personal_skills"
            entry["target"] = entry["target"][len("skills/"):]
        self.write_manifest()

    def test_v131_bundled_skills_move_and_rollback(self):
        self.bundled_skill_upgrade()
        dep = self.dep()
        self.assertFalse(any(row["action"] == "conflict" for row in dep.plan()))
        dep.apply()
        self.assertEqual(dep.verify()["status"], "pass")
        self.assertEqual(dep.inventory(), [])
        self.assertFalse(any(p.is_file() for p in (self.home / "skills").rglob("*")))
        self.assertFalse(any(key.startswith("skills/") for key in dep.record["files"]))
        for name in ("sample", "ponytail"):
            self.assertTrue((dep.personal_skills / name / "SKILL.md").is_file())
            self.assertEqual((dep.personal_skills / name / "agents/openai.yaml").read_bytes(),
                             b"policy:\n  allow_implicit_invocation: false\n")
        self.assertEqual(dep.apply()["status"], "unchanged")
        dep.restore()
        self.assertTrue((self.home / "skills/sample/SKILL.md").is_file())
        self.assertFalse((dep.personal_skills / "sample/SKILL.md").exists())

    def test_skill_move_preserves_unowned_old_root_files(self):
        self.bundled_skill_upgrade(installed=False)
        for name, data in (("sample", b"bundled skill\n"), ("ponytail", b"user skill\n")):
            old = self.home / f"skills/{name}/SKILL.md"
            old.parent.mkdir(parents=True, exist_ok=True)
            old.write_bytes(data)
        dep = self.dep()
        dep.apply()
        self.assertEqual(dep.verify()["status"], "pass")
        for name, data in (("sample", b"bundled skill\n"), ("ponytail", b"user skill\n")):
            self.assertEqual((self.home / f"skills/{name}/SKILL.md").read_bytes(), data)
            self.assertIn(f"skills/{name}/SKILL.md", dep.inventory())

    def test_skill_move_refuses_modified_owned_old_root_file(self):
        self.bundled_skill_upgrade()
        old = self.home / "skills/sample/SKILL.md"
        old.write_bytes(b"user edit")
        with self.assertRaises(ValueError):
            self.dep().apply(True)
        self.assertEqual(old.read_bytes(), b"user edit")
        self.assertFalse((self.root / "personal skills/sample/SKILL.md").exists())

    def test_legacy_profile_clash_reported_without_config_changes(self):
        self.manifest["files"].append({"source": "rules.md", "target": "sol.config.toml"})
        (self.source / "rules.md").write_text('model = "fixture"\n', encoding="utf-8")
        self.write_manifest()
        self.dep().apply()
        config = self.home / "config.toml"
        raw = config.read_bytes() + b'\n[profiles.sol]\nmodel = "user-choice"\n'
        config.write_bytes(raw)
        result = self.dep().verify()
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["errors"], [
            "Legacy profile clash: config.toml profiles.sol conflicts with sol.config.toml"])
        self.assertEqual(config.read_bytes(), raw)

    def test_unrelated_legacy_profile_keeps_verify_result(self):
        self.manifest["files"].append({"source": "rules.md", "target": "sol.config.toml"})
        (self.source / "rules.md").write_text('model = "fixture"\n', encoding="utf-8")
        self.write_manifest()
        self.dep().apply()
        before = self.dep().verify()
        config = self.home / "config.toml"
        config.write_bytes(config.read_bytes() + b'\n[profiles.user]\nmodel = "user-choice"\n')
        self.assertEqual(self.dep().verify(), before)

    def test_v1_migration_two_roots_and_restore(self):
        self.dep().apply()
        record_path = self.state / 'installed.json'
        record = json.loads(record_path.read_text())
        record.pop('personal_skills')  # A v1.0.1 ownership record.
        save_json(record_path, record)
        old = self.root / 'personal skills/old/SKILL.md'
        old.parent.mkdir(parents=True)
        old.write_bytes(b'old skill')
        self.manifest['version'] = '1.1.0'
        self.manifest['retired'] = [{'root': 'personal_skills', 'target': 'old/SKILL.md', 'sha256': digest(b'old skill')}]
        self.manifest['files'].append({'root': 'personal_skills', 'source': 'rules.md', 'target': 'new/SKILL.md'})
        self.write_manifest()
        d = self.dep()
        d.apply()
        self.assertFalse(old.exists())
        self.assertEqual(d.verify()['status'], 'pass')
        self.assertEqual(d.apply()['status'], 'unchanged')
        d.restore()
        self.assertEqual(old.read_bytes(), b'old skill')
        self.assertFalse((old.parent.parent / 'new/SKILL.md').exists())

    def test_orphan_skill_metadata_diagnosed_and_fingerprint_retired(self):
        orphan = self.root / 'personal skills/old/agents/openai.yaml'
        orphan.parent.mkdir(parents=True)
        orphan.write_bytes(b'interface: {}\n')
        self.assertIn('@personal/old/[missing SKILL.md]', self.dep().inventory())
        self.manifest['retired'] = [{'root': 'personal_skills',
            'target': 'old/agents/openai.yaml', 'sha256': digest(b'interface: {}\n')}]
        self.write_manifest()
        orphan.write_bytes(b'user modified')
        with self.assertRaises(ValueError):
            self.dep().apply(True)
        orphan.write_bytes(b'interface: {}\n')
        self.dep().apply()
        self.assertFalse(orphan.parent.parent.exists())
        self.assertEqual(self.dep().verify()['unmanaged_skill_findings'], [])
        self.dep().restore()
        self.assertEqual(orphan.read_bytes(), b'interface: {}\n')

    def test_personal_retirement_conflict_and_wrong_root_restore(self):
        old = self.root / 'personal skills/old/SKILL.md'
        old.parent.mkdir(parents=True)
        old.write_bytes(b'user edit')
        self.manifest['retired'] = [{'root': 'personal_skills', 'target': 'old/SKILL.md', 'sha256': digest(b'old')}]
        self.write_manifest()
        with self.assertRaises(ValueError):
            self.dep().apply(True)
        old.write_bytes(b'old')
        self.dep().apply()
        with self.assertRaises(ValueError):
            Deployment(self.source, self.home, self.state, self.root / 'wrong').restore()

    def test_personal_traversal_and_unknown_roots(self):
        d = self.dep()
        for key in ('@personal/../outside', '@personal/C:/outside', '@other/file'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                d.path(key)
        self.manifest['files'][0]['root'] = 'unknown'
        self.write_manifest()
        with self.assertRaises(ValueError):
            self.dep().plan()

    def test_personal_uninstall_and_failure_recovery(self):
        from unittest.mock import patch
        self.manifest['files'].append({'root': 'personal_skills', 'source': 'rules.md', 'target': 'new/SKILL.md'})
        self.write_manifest()
        d = self.dep()
        original = d._write
        def failure(key, data):
            if key == 'AGENTS.md' and data is not None:
                raise OSError('failure after personal write')
            original(key, data)
        with patch.object(d, '_write', failure), self.assertRaises(OSError):
            d.apply()
        self.assertFalse((self.root / 'personal skills/new/SKILL.md').exists())
        d.apply()
        d.uninstall()
        self.assertFalse((self.root / 'personal skills/new/SKILL.md').exists())
        d.restore()
        self.assertEqual(d.verify()['status'], 'pass')

    def test_personal_symlink_refused(self):
        root = self.root / 'personal skills'
        root.mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        try:
            (root / 'linked').symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('Symlink creation unavailable')
        with self.assertRaises(ValueError):
            self.dep().path('@personal/linked/SKILL.md')

    def test_install_idempotent_rollback(self):
        d = self.dep()
        d.apply()
        self.assertEqual(d.verify()["status"], "pass")
        previous = (self.state / "previous.json").read_bytes()
        self.assertEqual(d.apply()["status"], "unchanged")
        self.assertEqual(previous, (self.state / "previous.json").read_bytes())
        d.restore()
        self.assertFalse((self.home / "AGENTS.md").exists())

    def test_existing_files_need_adoption(self):
        self.home.mkdir()
        (self.home / "AGENTS.md").write_text("personal", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.dep().apply()
        d = self.dep()
        d.apply(True)
        d.restore()
        self.assertEqual((self.home / "AGENTS.md").read_text(), "personal")

    def test_local_edits_protected_even_with_adopt(self):
        self.dep().apply()
        (self.home / "AGENTS.md").write_text("user edits", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.dep().apply(True)
        with self.assertRaises(ValueError):
            self.dep().uninstall()

    def test_remove_obsolete_owned_file(self):
        self.dep().apply()
        self.manifest["files"] = []
        self.manifest["version"] = "2"
        self.write_manifest()
        d = self.dep()
        d.apply()
        self.assertFalse((self.home / "AGENTS.md").exists())
        d.restore()
        self.assertTrue((self.home / "AGENTS.md").exists())

    def test_config_preserves_model_and_other_values(self):
        self.home.mkdir()
        raw = b'model = "user-choice"\nmodel_reasoning_effort = "xhigh"\n[agents]\nenabled = false\n[other]\nsetting = "keep"\n'
        (self.home / "config.toml").write_bytes(raw)
        self.dep().apply()
        text = (self.home / "config.toml").read_text()
        self.assertIn('model = "user-choice"', text)
        self.assertIn('setting = "keep"', text)
        self.dep().uninstall()
        self.assertIn("enabled = false", (self.home / "config.toml").read_text())

    def test_unrelated_config_edit_survives_update(self):
        self.dep().apply()
        p = self.home / "config.toml"
        p.write_text('model = "changed"\n' + p.read_text(), encoding="utf-8")
        self.dep().apply()
        self.assertIn('model = "changed"', p.read_text())

    def test_managed_config_edit_conflicts(self):
        self.dep().apply()
        p = self.home / "config.toml"
        p.write_text(p.read_text().replace("enabled = true", "enabled = false"), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.dep().apply()

    def test_retired_fingerprint(self):
        self.home.mkdir()
        (self.home / "old.md").write_bytes(b"legacy")
        self.manifest["retired"] = [{"target": "old.md", "sha256": digest(b"legacy")}]
        self.write_manifest()
        d = self.dep()
        d.apply()
        self.assertFalse((self.home / "old.md").exists())
        d.restore()
        self.assertEqual((self.home / "old.md").read_bytes(), b"legacy")

    def test_interrupted_recovery(self):
        self.home.mkdir()
        (self.home / "AGENTS.md").write_bytes(b"after")
        save_json(self.state / "pending.json", {"home": str(self.home), "record": {"files": {}}, "files": {
            "AGENTS.md": {"before": base64.b64encode(b"before").decode(), "after": digest(b"after")}}})
        d = self.dep()
        with self.assertRaises(ValueError):
            d.apply()
        d.restore("pending.json")
        self.assertEqual((self.home / "AGENTS.md").read_bytes(), b"before")

    def test_rollback_rejects_post_install_edits(self):
        self.dep().apply()
        (self.home / "AGENTS.md").write_bytes(b"edit")
        with self.assertRaises(ValueError):
            self.dep().restore()

    def test_traversal_rejected(self):
        for rel in ["../outside", "C:/outside", "/tmp/file", "a\\b", "file.", "file "]:
            with self.subTest(rel=rel), self.assertRaises(ValueError):
                safe(self.home, rel)

    def test_symlink_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        self.home.mkdir()
        try:
            (self.home / "linked").symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("Symlink creation not available")
        with self.assertRaises(ValueError):
            safe(self.home, "linked/file")

    def test_unmanaged_files_survive(self):
        self.dep().apply()
        (self.home / "user.txt").write_bytes(b"keep")
        self.dep().uninstall()
        self.assertEqual((self.home / "user.txt").read_bytes(), b"keep")

    def test_atomic_write_failure_recovers(self):
        from unittest.mock import patch
        d = self.dep()
        original = d._write
        count = 0
        def failure(p, data):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated interruption")
            original(p, data)
        with patch.object(d, "_write", failure), self.assertRaises(OSError):
            d.apply()
        self.assertFalse((self.home / "AGENTS.md").exists())
        self.assertFalse((self.state / "pending.json").exists())

    def test_existing_identical_config_restored(self):
        self.home.mkdir()
        original = patch_agents(None, self.manifest["agent_settings"])
        (self.home / "config.toml").write_bytes(original)
        self.dep().apply()
        self.dep().uninstall()
        self.assertEqual((self.home / "config.toml").read_bytes(), original)

    def test_deleted_config_key_removed(self):
        self.dep().apply()
        self.manifest["agent_settings"].pop("max_concurrent_threads_per_session")
        self.manifest["version"] = "2"
        self.write_manifest()
        self.dep().apply()
        self.assertNotIn("max_concurrent", (self.home / "config.toml").read_text())

    def test_uninstall_removes_originally_absent_config(self):
        self.dep().apply()
        self.dep().uninstall()
        self.assertFalse((self.home / "config.toml").exists())

    def test_top_level_setting_goes_before_agents_table(self):
        patched = patch_agents(b"[agents]\nenabled = true\n", {"check_for_update_on_startup": False, "enabled": True})
        self.assertTrue(patched.decode().startswith("check_for_update_on_startup = false\n"))
        parsed = tomllib.loads(patched.decode())
        self.assertIs(parsed["check_for_update_on_startup"], False)
        self.assertEqual(parsed["agents"], {"enabled": True})

    def test_top_level_setting_alone_creates_no_agents_table(self):
        patched = patch_agents(None, {"check_for_update_on_startup": False})
        self.assertEqual(tomllib.loads(patched.decode()), {"check_for_update_on_startup": False})

    def test_top_level_setting_inserted_before_other_tables(self):
        parsed = tomllib.loads(patch_agents(b'model = "user"\n\n[profiles.a]\nk = 1\n', {"check_for_update_on_startup": False}).decode())
        self.assertEqual(parsed["model"], "user")
        self.assertIs(parsed["check_for_update_on_startup"], False)
        self.assertEqual(parsed["profiles"], {"a": {"k": 1}})

    def test_top_level_setting_applied_verified_and_uninstalled(self):
        self.manifest["agent_settings"]["check_for_update_on_startup"] = False
        self.write_manifest()
        self.dep().apply()
        self.assertEqual(self.dep().verify()["status"], "pass")
        self.assertIs(tomllib.loads((self.home / "config.toml").read_text(encoding="utf-8"))["check_for_update_on_startup"], False)
        self.dep().uninstall()
        self.assertFalse((self.home / "config.toml").exists())

    def test_multiline_toml_false_table_refused(self):
        raw = b'developer_instructions = """\n[agents]\nenabled = false\n"""\n[agents]\nenabled = false\n'
        with self.assertRaises(ValueError):
            patch_agents(raw, self.manifest["agent_settings"])

    def test_uninstall_removes_empty_created_table_preserving_user_model(self):
        self.dep().apply()
        path = self.home / "config.toml"
        path.write_text('model = "user"\n' + path.read_text(), encoding="utf-8")
        self.dep().uninstall()
        self.assertIn('model = "user"', path.read_text())
        self.assertNotIn('[agents]', path.read_text())

    def test_released_key_user_edit_survives_uninstall(self):
        self.dep().apply()
        self.manifest['agent_settings'].pop('max_concurrent_threads_per_session')
        self.manifest['version'] = '2'
        self.write_manifest()
        self.dep().apply()
        p = self.home / 'config.toml'
        p.write_text(p.read_text() + 'max_concurrent_threads_per_session = 7\n', encoding='utf-8')
        self.dep().uninstall()
        self.assertIn('max_concurrent_threads_per_session = 7', p.read_text())

    def test_repeated_uninstall_keeps_restore_point(self):
        d = self.dep()
        d.apply()
        d.uninstall()
        saved = (self.state / 'previous.json').read_bytes()
        self.assertEqual(d.uninstall()['status'], 'unchanged')
        self.assertEqual(saved, (self.state / 'previous.json').read_bytes())
        d.restore()
        self.assertEqual(d.verify()['status'], 'pass')

    def test_ownership_hash_is_verified(self):
        self.dep().apply()
        record = json.loads((self.state / 'installed.json').read_text())
        record['files']['AGENTS.md']['sha256'] = 'wrong'
        save_json(self.state / 'installed.json', record)
        self.assertEqual(self.dep().verify()['status'], 'fail')

    @unittest.skipUnless(os.name == "nt", "Windows junction test")
    def test_junction_refused(self):
        import subprocess
        self.home.mkdir()
        outside = self.root / "outside"
        outside.mkdir()
        junction = self.home / "linked"
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True)
        if result.returncode:
            self.skipTest("Junction creation unavailable")
        try:
            with self.assertRaises(ValueError):
                safe(self.home, "linked/file")
        finally:
            junction.rmdir()


if __name__ == "__main__":
    unittest.main()
