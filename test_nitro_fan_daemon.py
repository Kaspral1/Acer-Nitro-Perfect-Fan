#!/usr/bin/env python3
"""Testy logiki GPU w daemonie: +5 pkt na własnej krzywej, Zero-RPM tylko w Cichym."""

import unittest

import nitro_fan_daemon as d


class GpuCurveBoostTests(unittest.TestCase):
    def test_adds_five_points(self):
        self.assertAlmostEqual(d.boost_gpu_curve_pct(30.0), 35.0)
        self.assertAlmostEqual(d.boost_gpu_curve_pct(50.0), 55.0)

    def test_clamps_at_100(self):
        self.assertAlmostEqual(d.boost_gpu_curve_pct(97.0), 100.0)
        self.assertAlmostEqual(d.boost_gpu_curve_pct(100.0), 100.0)


class SharedLoopTests(unittest.TestCase):
    def test_hotter_picks_cpu_when_gpu_idle(self):
        self.assertAlmostEqual(d.hotter(70.0, 42.0), 70.0)
        self.assertAlmostEqual(d.hotter(None, 48.0), 48.0)
        self.assertIsNone(d.hotter(None, None))

    def test_silent_starts_when_cpu_is_hot_even_if_gpu_is_cool(self):
        loop = d.hotter(52.0, 36.0)
        self.assertTrue(d.update_gpu_spinning(False, loop, loop, allow_zero=True))


class ZeroRpmProfileTests(unittest.TestCase):
    def test_only_silent_allows_zero_rpm(self):
        self.assertTrue(d.allow_gpu_zero_rpm("Silent"))
        self.assertFalse(d.allow_gpu_zero_rpm("Balanced"))
        self.assertFalse(d.allow_gpu_zero_rpm("Turbo"))

    def test_balanced_stays_spinning_when_cool(self):
        self.assertTrue(d.update_gpu_spinning(False, 35.0, 35.0, allow_zero=False))

    def test_silent_stays_stopped_below_start(self):
        self.assertFalse(d.update_gpu_spinning(False, 45.0, 45.0, allow_zero=True))

    def test_silent_starts_at_48(self):
        self.assertTrue(d.update_gpu_spinning(False, 48.0, 48.0, allow_zero=True))

    def test_silent_stops_below_40(self):
        self.assertFalse(d.update_gpu_spinning(True, 39.0, 39.0, allow_zero=True))

    def test_unknown_profile_is_silent(self):
        self.assertEqual(d.clean_profile("Nope"), "Silent")
        self.assertEqual(d.clean_profile("Balanced"), "Balanced")


class GpuTargetTests(unittest.TestCase):
    def test_spinning_applies_boost(self):
        self.assertAlmostEqual(d.gpu_target_from_curve(30.0, True, 50.0), 35.0)

    def test_stopped_stays_zero(self):
        self.assertAlmostEqual(d.gpu_target_from_curve(30.0, False, 42.0), 0.0)

    def test_critical_is_100(self):
        self.assertAlmostEqual(d.gpu_target_from_curve(30.0, False, 88.0), 100.0)

    def test_balanced_cool_gpu_is_curve_plus_five(self):
        spinning = d.update_gpu_spinning(False, 42.0, 42.0, allow_zero=False)
        pct = d.gpu_target_from_curve(30.0, spinning, 42.0)
        self.assertTrue(spinning)
        self.assertAlmostEqual(pct, 35.0)


class SilentLockstepTests(unittest.TestCase):
    def test_lockstep_covers_silent_and_balanced(self):
        self.assertIn("Silent", d.LOCKSTEP_PROFILES)
        self.assertIn("Balanced", d.LOCKSTEP_PROFILES)
        self.assertNotIn("Turbo", d.LOCKSTEP_PROFILES)

    def test_spinning_uses_cpu_speed_for_both(self):
        cpu, gpu = d.match_silent_speeds(32.0, 41.0, True)
        self.assertAlmostEqual(cpu, 32.0)
        self.assertAlmostEqual(gpu, 32.0)
        self.assertAlmostEqual(cpu, gpu)

    def test_stopped_gpu_stays_zero(self):
        cpu, gpu = d.match_silent_speeds(32.0, 41.0, False)
        self.assertAlmostEqual(cpu, 32.0)
        self.assertAlmostEqual(gpu, 0.0)

    def test_offset_then_lockstep_keeps_them_equal(self):
        cpu, gpu = d.apply_speed_offset(
            32.0, 32.0, 10.0,
            force_gpu_floor=True,
            allow_zero_gpu=False,
        )
        cpu, gpu = d.match_silent_speeds(cpu, gpu, True)
        self.assertAlmostEqual(cpu, gpu)
        self.assertAlmostEqual(cpu, 42.0)


if __name__ == "__main__":
    unittest.main()
