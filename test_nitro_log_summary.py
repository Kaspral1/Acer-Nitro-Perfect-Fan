#!/usr/bin/env python3
"""Tests for telemetry log analysis, including per-day grouping."""

import csv
import tempfile
import unittest
from pathlib import Path

import nitro_log_summary as summary


HEADER = "timestamp,cpu_temp,gpu_temp,cpu_speed,gpu_speed,cpu_load,gpu_load,mode,profile"


def write_log(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(HEADER + "\n")
        writer = csv.writer(fh)
        writer.writerows(rows)


class AnalyzeLogsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "telemetry.csv"

    def tearDown(self):
        self.tmp.cleanup()

    def test_empty_file_returns_error(self):
        self.path.write_text(HEADER + "\n", encoding="utf-8")
        result = summary.analyze_logs(self.path)
        self.assertIn("error", result)

    def test_groups_rows_by_local_calendar_day(self):
        # Midday UTC stays on the same calendar date in typical timezones (UTC±11).
        write_log(self.path, [
            ["2026-08-19T12:00:00Z", 50, 45, 30, 0, 10, 5, "Dynamic", "Silent"],
            ["2026-08-19T12:02:00Z", 70, 60, 40, 20, 20, 15, "Dynamic", "Silent"],
            ["2026-08-20T12:00:00Z", 90, 80, 80, 70, 90, 80, "Dynamic", "Turbo"],
        ])
        result = summary.analyze_logs(self.path)
        self.assertNotIn("error", result)
        self.assertEqual(result["total_samples"], 3)
        self.assertEqual(result["cpu"]["max_temp"], 90.0)
        days = result["days"]
        self.assertEqual([d["date"] for d in days], ["2026-08-19", "2026-08-20"])
        self.assertEqual(days[0]["total_samples"], 2)
        self.assertEqual(days[0]["cpu"]["max_temp"], 70.0)
        self.assertEqual(days[0]["gpu"]["zero_rpm_pct"], 50.0)
        self.assertEqual(days[1]["total_samples"], 1)
        self.assertEqual(days[1]["cpu"]["max_temp"], 90.0)
        self.assertEqual(days[1]["cpu"]["high_temp_85c_sec"], 1)

    def test_skips_malformed_rows(self):
        write_log(self.path, [
            ["not-a-date", 50, 45, 30, 30, 10, 5, "Dynamic", "Silent"],
            ["2026-08-20T12:00:00Z", 55, 48, 32, 30, 12, 8, "Dynamic", "Balanced"],
        ])
        result = summary.analyze_logs(self.path)
        self.assertEqual(result["total_samples"], 1)
        self.assertEqual(result["days"][0]["date"], "2026-08-20")


if __name__ == "__main__":
    unittest.main()
