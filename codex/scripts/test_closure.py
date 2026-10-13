import unittest

from check_closure import evaluate, evaluate_integrity


class ClosureTests(unittest.TestCase):
    def artifact(self):
        release = {'status':'collected','tagName':'v1.2.2','tag_commit':'commit',
                   'assets':[{'name':'codex-setup-v1.2.2.zip','digest':'sha256:hash'}]}
        receipt = {'status':'pass','tag':'v1.2.2','commit':'commit','zip_sha256':'hash'}
        return release, receipt

    def test_matching_versions_do_not_clear_corrupted_owned_files(self):
        release, receipt = self.artifact()
        findings = evaluate_integrity({'status':'fail','errors':['AGENTS.md']}, release, receipt)
        self.assertEqual(set(findings), {'managed-integrity'})

    def test_stale_or_replaced_release_asset_requires_fresh_validation(self):
        release, receipt = self.artifact()
        self.assertEqual(evaluate_integrity({'status':'pass'},release,receipt), {})
        for field, changed in [('tag','v1.2.1'),('commit','another'),('zip_sha256','changed')]:
            with self.subTest(field=field):
                stale = {**receipt,field:changed}
                self.assertIn('release-artifact-evidence',evaluate_integrity({'status':'pass'},release,stale))
        release['assets']=[]
        self.assertIn('release-artifact-evidence',evaluate_integrity({'status':'pass'},release,receipt))

    def review(self, installed=None, release=None, registrations=None, routine=None):
        return evaluate({'version': '1.2.1'}, {'tools': {'rtk': {'version': '0.51.0'}}},
                        installed if installed is not None else {'version': '1.2.1'},
                        {'rtk': {'version': '0.51.0'}},
                        release if release is not None else {'status': 'collected', 'tagName': 'v1.2.1'},
                        registrations or {}, routine or {})

    def test_release_lag_is_not_successful_publication(self):
        findings = self.review(release={'status': 'collected', 'tagName': 'v1.1.4'})
        self.assertEqual(set(findings), {'publication-version'})

    def test_unavailable_github_and_missing_install_remain_unknown(self):
        findings = self.review(installed={}, release={'status': 'unknown', 'reason': 'offline'})
        self.assertIn('deployment-version', findings)
        self.assertEqual(findings['publication-unknown']['status'], 'unknown')

    def test_unchanged_baseline_needs_initial_review_only_for_registered_projects(self):
        findings = self.review(registrations={'projects': {'one': {}}},
                               routine={'projects': {'one': {'content_fingerprint': 'same'}, 'unregistered': {}}})
        self.assertEqual(set(findings), {'project-initial-review:one'})

    def test_reviewed_registered_project_and_matching_release_have_no_findings(self):
        self.assertEqual(self.review(registrations={'projects': {'one': {}}},
                                    routine={'projects': {'one': {'last_substantive_review': 'time'}}}), {})


if __name__ == '__main__':
    unittest.main()
