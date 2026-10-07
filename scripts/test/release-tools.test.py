import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
exporter=load('release_export','export-live-release.py')
review=load('release_review','reconcile-live-release.py')

class ReleaseToolsTests(unittest.TestCase):
    def test_existing_runtime_change_is_a_conflict_not_an_overwrite(self):
        self.assertEqual(review.classify(b'old',b'live fix',b'new'),'manual_reconciliation_required')
    def test_missing_existing_file_requires_review(self):
        self.assertEqual(review.classify(b'old',None,b'new'),'manual_reconciliation_required')
    def test_unchanged_base_allows_only_targeted_patch(self):
        self.assertEqual(review.classify(b'old',b'old',b'new'),'safe_patch')
    def test_new_file_and_already_applied_change(self):
        self.assertEqual(review.classify(None,None,b'new'),'safe_addition')
        self.assertEqual(review.classify(b'old',b'new',b'new'),'already_matches_target')
    def test_mobile_and_tests_are_not_mistaken_for_live_backend(self):
        self.assertFalse(review.relevant('apps/mobile/app/parcels.tsx'))
        self.assertFalse(review.relevant('services/api/test/parcel-tracking.test.mjs'))
        self.assertTrue(review.relevant('services/api/src/modules/parcel-tracking/service.mjs'))
    def test_metadata_never_outputs_environment_values(self):
        raw={'Id':'container','Image':'digest','State':{'Status':'running'},'Config':{'Env':['SECRET=never-output'],'Labels':{'org.opencontainers.image.revision':'abc'}}}
        with patch.object(exporter,'docker',return_value=json.dumps(raw)):
            result=exporter.metadata('app')
        self.assertNotIn('SECRET',json.dumps(result));self.assertNotIn('never-output',json.dumps(result))
    def test_database_inventory_is_explicitly_read_only(self):
        self.assertIn('BEGIN READ ONLY',exporter.INVENTORY_JS)
        self.assertIn('default_transaction_read_only=on',exporter.INVENTORY_JS)
        self.assertIn('readOnly:true',exporter.INVENTORY_JS)
        for verb in ['DELETE FROM','UPDATE users','ALTER TABLE','DROP TABLE']:
            self.assertNotIn(verb,exporter.INVENTORY_JS)
    def test_denied_docker_access_stops_without_retrying_privileged_commands(self):
        with patch.object(exporter.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','denied')) as run:
            with self.assertRaises(RuntimeError):exporter.docker('inspect','app')
            self.assertEqual(run.call_count,1)
            self.assertEqual(run.call_args.args[0],['docker','inspect','app'])

if __name__=='__main__':unittest.main(verbosity=2)
