"""Route tests for request validation: python -m unittest test_routes

Imports the Flask app, so it needs the full embedder dependencies; skipped otherwise.
"""

import os
import tempfile
import unittest
from pathlib import Path

try:
    import flask  # noqa: F401
    import sentence_transformers  # noqa: F401
    DEPS = True
except ImportError:
    DEPS = False


@unittest.skipUnless(DEPS, "embedder dependencies not installed")
class ScopeValidationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.cwd = os.getcwd()
        cls.run_dir = Path(cls.tmp.name) / "run"
        cls.run_dir.mkdir()
        os.chdir(cls.run_dir)  # the embedder keeps its data in ./data
        import embedder
        embedder.init_db()
        cls.client = embedder.app.test_client()

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls.cwd)
        cls.tmp.cleanup()

    def outside_entries(self):
        return sorted(p.name for p in Path(self.tmp.name).iterdir() if p.name != "run")

    def test_valid_ids_are_accepted(self):
        r = self.client.get("/status?user_id=u1&collection_id=c1")
        self.assertEqual(r.status_code, 200)

    def test_traversal_in_query_is_rejected_before_touching_disk(self):
        r = self.client.get("/status?user_id=..&collection_id=../escaped")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.outside_entries(), [])

    def test_traversal_in_json_body_is_rejected(self):
        r = self.client.post("/reset", json={"user_id": "u1", "collection_id": "../../x"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("collection_id", r.get_json()["error"])

    def test_traversal_in_path_is_rejected(self):
        r = self.client.delete("/collections/%2E%2E?user_id=u1")
        self.assertEqual(r.status_code, 400)

    def test_non_string_id_is_rejected(self):
        r = self.client.post("/search", json={"user_id": 7, "collection_id": "c1", "query": "x"})
        self.assertEqual(r.status_code, 400)

    def test_traversal_in_form_is_rejected(self):
        r = self.client.post("/ingest-pdf", data={"user_id": "u1", "collection_id": "a/b"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("collection_id", r.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
