#!/usr/bin/env python3
"""Testy zapisu prędkości manualnej — bez żywego hwmon / GUI."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import nbfc_control_api as api


class ManualSpeedSaveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.tmp.name, "config.json")
        Path(self.cfg).write_text(json.dumps({
            "mode": "manual",
            "backend": "auto",
            "manual_base": 30.0,
            "manual_speeds": {"0": 30.0, "1": 30.0},
            "speed_offset": 0,
        }))
        with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
            self.ctl = api.NBFCController(config_path=self.cfg, fallback_config_path=self.cfg)

    def tearDown(self):
        self.tmp.cleanup()

    def _reload(self):
        return json.loads(Path(self.cfg).read_text())

    def test_master_writes_both_fans(self):
        self.ctl.set_all_fans_speed(70)
        saved = self._reload()
        self.assertEqual(saved["mode"], "manual")
        self.assertEqual(saved["manual_base"], 70.0)
        self.assertEqual(saved["manual_speeds"]["0"], 70.0)
        self.assertEqual(saved["manual_speeds"]["1"], 70.0)
        self.assertEqual(saved["backend"], "auto")

    def test_gpu_slider_without_offset_is_independent(self):
        self.ctl.set_all_fans_speed(40)
        self.assertTrue(self.ctl.set_fan_speed(1, 80))
        saved = self._reload()
        self.assertEqual(saved["manual_speeds"]["0"], 40.0)
        self.assertEqual(saved["manual_speeds"]["1"], 80.0)
        self.assertEqual(saved["manual_base"], 40.0)

    def test_cpu_slider_without_offset_is_independent(self):
        self.ctl.set_all_fans_speed(40)
        self.assertTrue(self.ctl.set_fan_speed(0, 65))
        saved = self._reload()
        self.assertEqual(saved["manual_speeds"]["0"], 65.0)
        self.assertEqual(saved["manual_speeds"]["1"], 40.0)
        self.assertEqual(saved["manual_base"], 40.0)

    def test_lowering_cpu_does_not_move_master(self):
        self.ctl.set_all_fans_speed(70)
        self.assertTrue(self.ctl.set_fan_speed(0, 40))
        saved = self._reload()
        self.assertEqual(saved["manual_speeds"]["0"], 40.0)
        self.assertEqual(saved["manual_speeds"]["1"], 70.0)
        self.assertEqual(saved["manual_base"], 70.0)

    def test_other_save_does_not_relink_independent_speeds(self):
        self.ctl.set_fan_speed(0, 70)
        self.ctl.set_fan_speed(1, 45)
        self.ctl.set_auto_logging(False)
        saved = self._reload()
        self.assertEqual(saved["manual_speeds"]["0"], 70.0)
        self.assertEqual(saved["manual_speeds"]["1"], 45.0)

    def test_gpu_slider_ignored_when_offset_set(self):
        self.ctl.set_all_fans_speed(40)
        self.ctl.set_speed_offset(10)
        before = self._reload()
        self.assertTrue(self.ctl.set_fan_speed(1, 90))
        after = self._reload()
        self.assertEqual(after["manual_base"], before["manual_base"])
        self.assertEqual(after["manual_speeds"], before["manual_speeds"])

    def test_offset_rewrites_effective_pwm(self):
        self.ctl.set_all_fans_speed(40)
        self.ctl.set_speed_offset(15)
        saved = self._reload()
        self.assertEqual(saved["manual_base"], 40.0)
        self.assertEqual(saved["manual_speeds"]["0"], 55.0)
        self.assertEqual(saved["manual_speeds"]["1"], 40.0)
        self.assertEqual(saved["backend"], "auto")

    def test_manual_floor(self):
        self.ctl.set_all_fans_speed(10)
        saved = self._reload()
        self.assertGreaterEqual(saved["manual_base"], 30.0)
        self.assertGreaterEqual(saved["manual_speeds"]["0"], 30.0)


class CpuFreqTests(unittest.TestCase):
    def _ctl(self, tmp):
        cfg = os.path.join(tmp, "config.json")
        Path(cfg).write_text("{}")
        with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
            return api.NBFCController(config_path=cfg, fallback_config_path=cfg)

    def test_average_mhz_from_sysfs(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctl = self._ctl(tmp)
            names = ["cpu0", "cpu1", "cpu10", "cpufreq", "cpu0online"]

            def fake_listdir(path):
                if path == "/sys/devices/system/cpu":
                    return names
                raise FileNotFoundError(path)

            def fake_read(path):
                mapping = {
                    "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq": "2500000",
                    "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq": "4500000",
                    "/sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq": "1500000",
                    "/sys/devices/system/cpu/cpu1/cpufreq/cpuinfo_max_freq": "4500000",
                    "/sys/devices/system/cpu/cpu10/cpufreq/scaling_cur_freq": "2000000",
                    "/sys/devices/system/cpu/cpu10/cpufreq/cpuinfo_max_freq": "4500000",
                }
                return mapping.get(path)

            with mock.patch.object(os, "listdir", side_effect=fake_listdir):
                with mock.patch.object(ctl, "_read_file_content", side_effect=fake_read):
                    self.assertEqual(ctl._get_cpu_freq_mhz(), (2000.0, 4500.0))

    def test_missing_sysfs_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctl = self._ctl(tmp)
            with mock.patch.object(os, "listdir", side_effect=OSError("no cpu")):
                self.assertEqual(ctl._get_cpu_freq_mhz(), (None, None))


class SensorDisplayTests(unittest.TestCase):
    def test_get_fan_status_does_not_max_stuck_ec_gpu(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = os.path.join(tmp, "config.json")
            Path(cfg).write_text(json.dumps({
                "mode": "dynamic",
                "manual_speeds": {"0": 30.0, "1": 30.0},
            }))
            with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
                ctl = api.NBFCController(config_path=cfg, fallback_config_path=cfg)

            fake_backend = mock.Mock()
            fake_backend.name = "acer_nitro_ec"
            fake_backend.read_fan_rpm.side_effect = lambda fan_id: 3400 if fan_id == "1" else 0
            fake_backend.read_pwm_pct.side_effect = lambda fan_id: 33.0 if fan_id == "1" else 0.0

            ctl._fan_backend = fake_backend
            ctl._parse_sensors_output = mock.Mock(return_value=(0.0, 0.0, 0, 0, {}))
            with mock.patch.object(api, "read_chip_temps", return_value={
                "cpu": 61.0,
                "gpu": 54.0,
                "sys": 70.0,
            }):
                status = ctl.get_fan_status()

        self.assertEqual(status["0"]["temperature"], 61.0)
        self.assertEqual(status["1"]["temperature"], 54.0)
        self.assertEqual(status["0"]["rpm"], 3400)
        self.assertEqual(status["1"]["rpm"], 0)
        self.assertEqual(status["1"]["speed"], 0.0)

    def test_get_fan_status_keeps_none_when_sensors_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = os.path.join(tmp, "config.json")
            Path(cfg).write_text("{}")
            with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
                ctl = api.NBFCController(config_path=cfg, fallback_config_path=cfg)
            ctl._fan_backend = False
            ctl._parse_sensors_output = mock.Mock(return_value=(0.0, 0.0, 0, 0, {}))
            ctl._read_sysfs_temperatures = mock.Mock(return_value=(0.0, 0.0))
            status = ctl.get_fan_status()
        self.assertIsNone(status["0"]["temperature"])
        self.assertIsNone(status["1"]["temperature"])
        self.assertIsNone(status["0"]["rpm"])


class FactorySilentDefaultsTests(unittest.TestCase):
    """Ustawienia → Przywróć domyślne musi dawać te same krzywe Cichego/Normalnego co CPU."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.tmp.name, "config.json")
        Path(self.cfg).write_text(json.dumps({
            "mode": "dynamic",
            "profile": "Silent",
            "curve_source": "default",
            "default_profiles": {
                "Silent": {
                    "cpu": [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]],
                    "gpu": [[45, 35], [55, 40], [65, 48], [75, 68], [85, 90]],
                }
            },
        }))
        with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
            self.ctl = api.NBFCController(config_path=self.cfg, fallback_config_path=self.cfg)

    def tearDown(self):
        self.tmp.cleanup()

    def test_factory_silent_cpu_matches_gpu(self):
        factory = self.ctl.factory_profiles["Silent"]
        self.assertEqual(factory["cpu"], factory["gpu"])
        self.assertEqual(
            factory["gpu"],
            [(45.0, 30.0), (55.0, 30.0), (65.0, 30.0), (75.0, 42.0), (85.0, 65.0)],
        )

    def test_restore_replaces_old_silent_gpu_curve(self):
        self.assertNotEqual(
            self.ctl.profiles["Silent"]["gpu"],
            self.ctl.factory_profiles["Silent"]["gpu"],
        )
        self.ctl.reset_default_curves("Silent")
        silent = self.ctl.profiles["Silent"]
        self.assertEqual(silent["cpu"], silent["gpu"])
        self.assertEqual(silent["gpu"], self.ctl.factory_profiles["Silent"]["gpu"])
        saved = json.loads(Path(self.cfg).read_text())
        self.assertEqual(saved["default_profiles"]["Silent"]["cpu"], saved["default_profiles"]["Silent"]["gpu"])

    def test_factory_balanced_cpu_matches_gpu(self):
        factory = self.ctl.factory_profiles["Balanced"]
        self.assertEqual(factory["cpu"], factory["gpu"])
        self.assertEqual(
            factory["gpu"],
            [(45.0, 30.0), (55.0, 32.0), (65.0, 42.0), (75.0, 62.0), (85.0, 100.0)],
        )

    def test_restore_replaces_old_balanced_gpu_curve(self):
        self.ctl.profiles["Balanced"]["gpu"] = [
            (45.0, 38.0), (55.0, 46.0), (65.0, 58.0), (75.0, 78.0), (85.0, 100.0),
        ]
        self.ctl.reset_default_curves("Balanced")
        balanced = self.ctl.profiles["Balanced"]
        self.assertEqual(balanced["cpu"], balanced["gpu"])
        self.assertEqual(balanced["gpu"], self.ctl.factory_profiles["Balanced"]["gpu"])
        saved = json.loads(Path(self.cfg).read_text())
        self.assertEqual(
            saved["default_profiles"]["Balanced"]["cpu"],
            saved["default_profiles"]["Balanced"]["gpu"],
        )

    def test_factory_turbo_cpu_matches_gpu(self):
        factory = self.ctl.factory_profiles["Turbo"]
        self.assertEqual(factory["cpu"], factory["gpu"])
        self.assertEqual(
            factory["gpu"],
            [(45.0, 45.0), (55.0, 60.0), (65.0, 80.0), (75.0, 95.0), (85.0, 100.0)],
        )

    def test_restore_replaces_old_turbo_curve(self):
        self.ctl.profiles["Turbo"]["cpu"] = [
            (45.0, 38.0), (55.0, 52.0), (65.0, 70.0), (75.0, 88.0), (85.0, 100.0),
        ]
        self.ctl.profiles["Turbo"]["gpu"] = [
            (45.0, 45.0), (55.0, 62.0), (65.0, 80.0), (75.0, 95.0), (85.0, 100.0),
        ]
        self.ctl.reset_default_curves("Turbo")
        turbo = self.ctl.profiles["Turbo"]
        self.assertEqual(turbo["cpu"], turbo["gpu"])
        self.assertEqual(turbo["cpu"], self.ctl.factory_profiles["Turbo"]["cpu"])
        saved = json.loads(Path(self.cfg).read_text())
        self.assertEqual(
            saved["default_profiles"]["Turbo"]["cpu"],
            saved["default_profiles"]["Turbo"]["gpu"],
        )


class RunCommandTimeoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.tmp.name, "config.json")
        Path(self.cfg).write_text("{}")
        with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
            self.ctl = api.NBFCController(config_path=self.cfg, fallback_config_path=self.cfg)

    def tearDown(self):
        self.tmp.cleanup()

    def test_timeout_returns_none(self):
        with mock.patch.object(
            api.subprocess,
            "run",
            side_effect=api.subprocess.TimeoutExpired(cmd=["sensors"], timeout=3),
        ):
            self.assertIsNone(self.ctl._run_command(["sensors"]))

    def test_passes_timeout_to_subprocess(self):
        with mock.patch.object(api.subprocess, "run") as run:
            run.return_value = mock.Mock(stdout="ok\n")
            self.assertEqual(self.ctl._run_command(["sensors"]), "ok")
            self.assertEqual(run.call_args.kwargs["timeout"], 3.0)


class ClearTelemetryLogsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.tmp.name, "config.json")
        Path(self.cfg).write_text("{}")
        with mock.patch.object(api, "detect_from_config", side_effect=RuntimeError("no hwmon")):
            self.ctl = api.NBFCController(config_path=self.cfg, fallback_config_path=self.cfg)

    def tearDown(self):
        self.tmp.cleanup()

    def test_deletes_existing_file(self):
        log = os.path.join(self.tmp.name, "telemetry.csv")
        Path(log).write_text("timestamp,cpu_temp\n")
        with mock.patch.object(self.ctl, "_telemetry_log_candidates", return_value=[log]):
            result = self.ctl.clear_telemetry_logs()
        self.assertTrue(result["ok"])
        self.assertEqual(result["deleted"], 1)
        self.assertFalse(os.path.exists(log))

    def test_already_empty(self):
        missing = os.path.join(self.tmp.name, "missing.csv")
        with mock.patch.object(self.ctl, "_telemetry_log_candidates", return_value=[missing]):
            result = self.ctl.clear_telemetry_logs()
        self.assertTrue(result["ok"])
        self.assertEqual(result["deleted"], 0)

    def test_permission_error(self):
        blocked = os.path.join(self.tmp.name, "blocked.csv")
        with mock.patch.object(self.ctl, "_telemetry_log_candidates", return_value=[blocked]):
            with mock.patch("os.path.isfile", return_value=True):
                with mock.patch("os.remove", side_effect=PermissionError("denied")):
                    result = self.ctl.clear_telemetry_logs()
        self.assertFalse(result["ok"])
        self.assertEqual(result["deleted"], 0)
        self.assertIn("error", result)

    def test_handle_command_emits_json(self):
        with mock.patch.object(self.ctl, "clear_telemetry_logs", return_value={"ok": True, "deleted": 1}):
            with mock.patch("builtins.print") as printed:
                api.handle_command(self.ctl, "clear_logs")
        payload = json.loads(printed.call_args[0][0])
        self.assertEqual(payload["clear_logs_response"]["deleted"], 1)
        self.assertTrue(payload["clear_logs_response"]["ok"])


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent)
    unittest.main()
