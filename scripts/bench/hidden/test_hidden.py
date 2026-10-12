# Hidden grading tests for the bench fixture. Never copied into a run before the agents finish; report.py copies them in only to grade.
import unittest

from textkit.duration import parse_duration
from textkit.slug import slugify
from textkit.stats import percentile


class Slug(unittest.TestCase):
    def test_basic(self): self.assertEqual(slugify("Hello, World!"), "hello-world")
    def test_accents(self): self.assertEqual(slugify("Crème brûlée"), "creme-brulee")
    def test_collapse_and_trim(self): self.assertEqual(slugify("  --a__b--  "), "a-b")
    def test_non_ascii_dropped(self): self.assertEqual(slugify("日本 abc"), "abc")
    def test_empty(self): self.assertEqual(slugify("!!!"), "")
    def test_max_len_trailing_dash(self): self.assertEqual(slugify("a b c d", 4), "a-b")
    def test_max_len_exact(self): self.assertEqual(slugify("abcdef", 3), "abc")
    def test_max_len_longer_than_slug(self): self.assertEqual(slugify("ab", 10), "ab")
    def test_max_len_invalid(self):
        with self.assertRaises(ValueError): slugify("abc", 0)


class Duration(unittest.TestCase):
    def test_examples(self):
        self.assertEqual(parse_duration("1h30m"), 5400)
        self.assertEqual(parse_duration(" 2d 3s "), 172803)
        self.assertEqual(parse_duration("0s"), 0)
        self.assertEqual(parse_duration("90m"), 5400)
    def test_all_units(self): self.assertEqual(parse_duration("1d1h1m1s"), 90061)
    def test_invalid(self):
        for bad in ("", "   ", "10", "5x", "1m1h", "1h1h", "-1s", "1.5h", "1H", "h"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError): parse_duration(bad)


class Percentile(unittest.TestCase):
    def test_examples(self):
        self.assertAlmostEqual(percentile([1, 2, 3, 4], 50), 2.5)
        self.assertAlmostEqual(percentile([5], 90), 5.0)
        self.assertAlmostEqual(percentile([3, 1, 2], 0), 1.0)
    def test_ends_and_interp(self):
        self.assertAlmostEqual(percentile([10, 20, 30], 100), 30.0)
        self.assertAlmostEqual(percentile([10, 20, 30, 40, 50], 10), 14.0)
    def test_iterable_not_modified(self):
        v = [3, 1, 2]
        percentile(v, 50)
        self.assertEqual(v, [3, 1, 2])
        self.assertAlmostEqual(percentile(iter([4, 2]), 50), 3.0)
    def test_invalid(self):
        for args in (([], 50), ([1], -1), ([1], 100.5)):
            with self.subTest(args=args):
                with self.assertRaises(ValueError): percentile(*args)
