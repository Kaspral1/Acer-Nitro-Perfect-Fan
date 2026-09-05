#!/usr/bin/env python3
"""Testy warstwy backendów — bez żywego hwmon / nbfc."""

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fan_backend as fb


class DetectTests(unittest.TestCase):
    def test_read_config_backend_auto_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text("{}")
            self.assertEqual(fb.read_config_backend(path), fb.BACKEND_AUTO)

    def test_read_config_backend_nbfc(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"backend": "nbfc"}))
            self.assertEqual(fb.read_config_backend(path), fb.BACKEND_NBFC)

    def test_read_config_backend_damx(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"backend": "damx"}))
            self.assertEqual(fb.read_config_backend(path), fb.BACKEND_DAMX)

    def test_read_config_backend_invalid_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"backend": "wmi"}))
            self.assertEqual(fb.read_config_backend(path), fb.BACKEND_AUTO)

    def test_oversized_config_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_bytes(b'{"backend":"nbfc","pad":"' + (b"x" * (fb.CONFIG_MAX_BYTES)) + b'"}')
            self.assertEqual(fb.read_config_backend(path), fb.BACKEND_AUTO)

    def test_read_json_limited_rejects_huge_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_bytes(b"{" + (b"a" * (fb.CONFIG_MAX_BYTES + 1)) + b"}")
            with self.assertRaises(ValueError):
                fb.read_json_limited(path)

    def test_atomic_write_replaces_without_tmp_leftovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text('{"old": true}')
            os.chmod(path, 0o664)
            fb.atomic_write_json(path, {"mode": "dynamic", "profile": "Silent"})
            saved = json.loads(path.read_text())
            self.assertEqual(saved["mode"], "dynamic")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o664)
            leftovers = [p for p in Path(tmp).iterdir() if p.suffix == ".tmp"]
            self.assertEqual(leftovers, [])

    def test_detect_prefers_ec_over_nbfc(self):
        ec = Path("/sys/class/hwmon/hwmon6")
        nbfc = Path("/run/nbfc_service.socket")
        with mock.patch.object(fb, "find_hwmon", return_value=ec), mock.patch.object(
            fb, "nbfc_socket_path", return_value=nbfc
        ):
            backend, why = fb.detect_backend("auto")
        self.assertIsInstance(backend, fb.AcerNitroEcBackend)
        self.assertIn("acer_nitro_ec", why)
        self.assertIn("nbfc", why)

    def test_detect_nbfc_when_no_ec(self):
        nbfc = Path("/run/nbfc_service.socket")
        with mock.patch.object(fb, "find_hwmon", return_value=None), mock.patch.object(
            fb, "nbfc_socket_path", return_value=nbfc
        ):
            backend, why = fb.detect_backend("auto")
        self.assertIsInstance(backend, fb.NbfcBackend)
        self.assertEqual(backend.name, fb.BACKEND_NBFC)
        self.assertIn("nbfc", why)

    def test_detect_forced_nbfc_without_socket_fails(self):
        with mock.patch.object(fb, "find_hwmon", return_value=Path("/x")), mock.patch.object(
            fb, "nbfc_socket_path", return_value=None
        ):
            with self.assertRaises(RuntimeError):
                fb.detect_backend(fb.BACKEND_NBFC)

    def test_detect_nothing_fails(self):
        with mock.patch.object(fb, "find_hwmon", return_value=None), mock.patch.object(
            fb, "nbfc_socket_path", return_value=None
        ), mock.patch.object(fb, "detect_damx_backend", return_value=None):
            with self.assertRaises(RuntimeError):
                fb.detect_backend("auto")

    def test_auto_does_not_enable_damx_implicitly(self):
        damx = mock.Mock(spec=fb.DamxBackend)
        with mock.patch.object(fb, "find_hwmon", return_value=None), mock.patch.object(
            fb, "nbfc_socket_path", return_value=None
        ), mock.patch.object(fb, "detect_damx_backend", return_value=damx) as detect_damx:
            with self.assertRaises(RuntimeError):
                fb.detect_backend("auto")
        detect_damx.assert_not_called()

    def test_detect_forced_damx(self):
        damx = mock.Mock(spec=fb.DamxBackend)
        damx.name = fb.BACKEND_DAMX
        with mock.patch.object(fb, "find_hwmon", return_value=None), mock.patch.object(
            fb, "nbfc_socket_path", return_value=None
        ), mock.patch.object(fb, "detect_damx_backend", return_value=damx):
            backend, why = fb.detect_backend(fb.BACKEND_DAMX)
        self.assertIs(backend, damx)
        self.assertIn("DAMX", why)


class DamxBackendTests(unittest.TestCase):
    def setUp(self):
        self.backend = fb.DamxBackend(Path("/run/DAMX.sock"))

    def test_requires_fan_speed_feature(self):
        self.backend._request = mock.Mock(return_value={
            "success": True,
            "data": {"available_features": ["thermal_profile", "fan_speed"]},
        })
        self.assertIn("fan_speed", self.backend.get_supported_features())

    def test_json_round_trip_buffers_split_response(self):
        response = json.dumps({
            "success": True,
            "data": {"available_features": ["fan_speed"]},
        }).encode("utf-8")

        class FakeSocket:
            def __init__(self):
                self.chunks = [response[:12], response[12:]]
                self.sent = b""
                self.connected_to = None
                self.closed = False

            def settimeout(self, _timeout):
                pass

            def connect(self, path):
                self.connected_to = path

            def sendall(self, payload):
                self.sent = payload

            def recv(self, _size):
                return self.chunks.pop(0) if self.chunks else b""

            def close(self):
                self.closed = True

        fake = FakeSocket()
        with mock.patch.object(fb.socket, "socket", return_value=fake):
            backend = fb.DamxBackend(Path("/run/DAMX.sock"))
            self.assertEqual(backend.get_supported_features(), {"fan_speed"})

        self.assertEqual(fake.connected_to, "/run/DAMX.sock")
        self.assertEqual(
            json.loads(fake.sent.decode("utf-8")),
            {"command": "get_supported_features", "params": {}},
        )
        self.assertTrue(fake.closed)

    def test_maps_fan_speed_settings(self):
        self.backend._request = mock.Mock(return_value={
            "success": True,
            "data": {"fan_speed": {"cpu": "35", "gpu": "42"}},
        })
        self.assertEqual(self.backend.read_pwm_pct("1"), 35.0)
        self.assertEqual(self.backend.read_pwm_pct("2"), 42.0)

    def test_writing_one_fan_preserves_the_other(self):
        self.backend._fan_cache = (30.0, 44.0)
        self.backend._fan_cache_at = 10**9
        self.backend._request = mock.Mock(return_value={"success": True, "data": {}})
        self.backend.write_pwm_pct("1", 55)
        self.backend._request.assert_called_once_with(
            "set_fan_speed", {"cpu": 55, "gpu": 44}
        )

    def test_restore_auto_sets_both_fans_to_zero(self):
        self.backend._request = mock.Mock(return_value={"success": True, "data": {}})
        self.backend.restore_auto()
        self.backend._request.assert_called_once_with(
            "set_fan_speed", {"cpu": 0, "gpu": 0}
        )


class NbfcParseTests(unittest.TestCase):
    SAMPLE = {
        "SelectedConfigId": "Acer Nitro AN515-54",
        "Fans": [
            {"Name": "CPU fan", "Temperature": 51.2, "CurrentSpeed": 33.0},
            {"Name": "GPU fan", "Temperature": 48.0, "CurrentSpeed": 22.5},
        ],
    }

    def test_maps_daemon_fan_ids(self):
        backend = fb.NbfcBackend(Path("/run/nbfc_service.socket"))
        backend._cache = self.SAMPLE
        backend._cache_at = 10**9
        cpu = backend._fan(self.SAMPLE, "1")
        gpu = backend._fan(self.SAMPLE, "2")
        self.assertEqual(cpu["Name"], "CPU fan")
        self.assertEqual(gpu["Name"], "GPU fan")
        self.assertEqual(backend.read_pwm_pct("1"), 33.0)
        self.assertEqual(backend.read_pwm_pct("2"), 22.5)
        temps = backend.read_temps()
        self.assertAlmostEqual(temps["cpu"], 51.2)
        self.assertAlmostEqual(temps["gpu"], 48.0)

    def test_pwm_helpers(self):
        self.assertEqual(fb.pct_to_pwm(100), 255)
        self.assertEqual(fb.pct_to_pwm(0), 0)
        self.assertEqual(fb.pwm_to_pct(255), 100)


class ChipTempPickTests(unittest.TestCase):
    def test_cpu_prefers_package_over_noisy_ec(self):
        self.assertEqual(fb.pick_cpu_temp(71.0, 59.0), 59.0)
        self.assertEqual(fb.pick_cpu_temp(55.0, 72.0), 72.0)

    def test_cpu_falls_back_to_ec(self):
        self.assertEqual(fb.pick_cpu_temp(64.0, None), 64.0)
        self.assertIsNone(fb.pick_cpu_temp(None, None))
        self.assertIsNone(fb.pick_cpu_temp(0.0, 200.0))

    def test_gpu_prefers_nvidia_then_acer_not_max(self):
        # Stuck EC 59 must not win over real 54
        self.assertEqual(fb.pick_gpu_temp(59.0, 54.0, 54.0), 54.0)
        self.assertEqual(fb.pick_gpu_temp(59.0, 54.0, None), 54.0)
        self.assertEqual(fb.pick_gpu_temp(59.0, None, None), 59.0)
        self.assertEqual(fb.pick_gpu_temp(59.0, None, 53.0), 53.0)
        self.assertIsNone(fb.pick_gpu_temp(None, None, None))


class HwmonScanTests(unittest.TestCase):
    def test_find_hwmon_by_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a = root / "hwmon0"
            b = root / "hwmon1"
            a.mkdir()
            b.mkdir()
            (a / "name").write_text("coretemp\n")
            (b / "name").write_text("acer_nitro_ec\n")
            with mock.patch.object(fb, "HWMON_ROOT", root):
                found = fb.find_hwmon("acer_nitro_ec")
            self.assertEqual(found, b)


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent)
    unittest.main()
