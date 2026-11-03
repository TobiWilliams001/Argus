"""Unit tests for scoping.py: python -m unittest test_scoping"""

import tempfile
import unittest
from pathlib import Path

from scoping import collection_dir, valid_id


class ValidIdTest(unittest.TestCase):
    def test_accepts_ids_the_app_generates(self):
        for value in ("default", "3f2a9c1e", "6b1f0c2e-8d4a-4f7e-9c3b-2a1d5e6f7a8b", "user_1"):
            self.assertTrue(valid_id(value), value)

    def test_rejects_path_tricks_and_bad_types(self):
        for value in ("", "..", ".", "../x", "a/b", "a\\b", "/etc", "a b", "a\x00b", "é", "x" * 65, None, 7, ["a"]):
            self.assertFalse(valid_id(value), repr(value))

    def test_length_boundary(self):
        self.assertTrue(valid_id("x" * 64))
        self.assertFalse(valid_id("x" * 65))


class CollectionDirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "data"
        self.root.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_returns_path_inside_data_dir(self):
        path = collection_dir(self.root, "u1", "c1")
        self.assertEqual(path, (self.root / "u1" / "c1").resolve())

    def test_refuses_traversal(self):
        for user, col in (("..", "x"), ("u1", ".."), ("u1", "../../etc")):
            with self.assertRaises(ValueError):
                collection_dir(self.root, user, col)

    def test_refuses_symlink_escape(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        (self.root / "u1").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            collection_dir(self.root, "u1", "c1")


if __name__ == "__main__":
    unittest.main()
