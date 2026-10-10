"""Unit tests for retrieval.py (no models needed): python -m unittest test_retrieval"""

import unittest

import numpy as np

from retrieval import BM25, chunk_text, rrf, search

DOC = ("Argus keeps data local. FAISS stores the vectors. " * 20
       + "x = 1 " * 400 + "The end.")


class ChunkTextTest(unittest.TestCase):
    def test_chunks_are_contiguous_substrings(self):
        normalised = " ".join(DOC.split())
        for cap in (False, True):
            for c in chunk_text(DOC, "doc", size=200, overlap=40, hard_cap=cap):
                self.assertIn(c["text"], normalised)

    def test_hard_cap_bounds_chunk_length(self):
        uncapped = chunk_text(DOC, "doc", size=200, overlap=40, hard_cap=False)
        capped   = chunk_text(DOC, "doc", size=200, overlap=40, hard_cap=True)
        self.assertGreater(max(len(c["text"]) for c in uncapped), 1000)
        self.assertLessEqual(max(len(c["text"]) for c in capped), 200 + 100 + 40)

    def test_idx_continues_from_base(self):
        chunks = chunk_text(DOC, "doc", base_idx=7, size=200)
        self.assertEqual([c["idx"] for c in chunks], list(range(7, 7 + len(chunks))))


class BM25Test(unittest.TestCase):
    def test_ranks_exact_term_match_first(self):
        bm25 = BM25(["the cat sat", "dogs bark loudly", "a cat and a dog"])
        self.assertEqual([i for i, _ in bm25.search("bark", 3)], [1])
        self.assertEqual(bm25.search("cat", 3)[0][0], 0)

    def test_no_overlap_returns_nothing(self):
        self.assertEqual(BM25(["alpha beta"]).search("gamma", 5), [])


class FusionTest(unittest.TestCase):
    def test_rrf_rewards_agreement(self):
        self.assertEqual(rrf([[1, 2, 3], [3, 2, 1], [2]])[0], 2)

    def test_hybrid_finds_keyword_only_match(self):
        chunks = [{"text": t, "source": "s", "idx": i}
                  for i, t in enumerate(["semantic match", "unrelated", "error E1234 code"])]
        matrix = np.eye(3, dtype=np.float32)
        q_emb  = np.array([[1, 0, 0]], dtype=np.float32)
        vector = search("E1234", q_emb, chunks, matrix=matrix, top_k=1, mode="vector")
        hybrid = search("E1234", q_emb, chunks, matrix=matrix, bm25=BM25([c["text"] for c in chunks]),
                        top_k=2, mode="hybrid")
        self.assertEqual(vector[0]["idx"], 0)
        self.assertIn(2, [h["idx"] for h in hybrid])
        self.assertTrue(all("similarity" in h for h in hybrid))


if __name__ == "__main__":
    unittest.main()
