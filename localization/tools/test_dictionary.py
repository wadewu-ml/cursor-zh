"""Regression tests for the current dictionary validator."""
import json
import tempfile
import unittest
from pathlib import Path

from validate_dictionary import validate_patterns


class PatternValidationTests(unittest.TestCase):
    def test_invalid_regex_and_flags_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "patterns.json"
            for regex, flags in [("(", ""), ("x", "ii"), ("x", "z")]:
                with self.subTest(regex=regex, flags=flags):
                    target.write_text(json.dumps({"patterns": [
                        {"regex": regex, "flags": flags, "replacement": "y"}
                    ]}), encoding="utf-8")
                    self.assertTrue(validate_patterns(target)[1])

    def test_valid_pattern_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "patterns.json"
            target.write_text(json.dumps({"patterns": [
                {"regex": "^Hello (.+)$", "flags": "i", "replacement": "你好 $1"}
            ]}), encoding="utf-8")
            count, errors, warnings = validate_patterns(target)
            self.assertEqual(count, 1)
            self.assertEqual(errors, [])
            self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
