#!/usr/bin/env python3
"""Build the pinned upstream baseline locally. This script never uploads firmware."""

import datetime
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import struct
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/geekmagic-open-firmware"
CACHE = Path.home() / "Library/Caches/Deepet/firmware"
STAGE = CACHE / "geekmagic-open-firmware"
PIO = CACHE / "venv/bin/pio"
COMMIT = "a0c2ddcef4e76fa6eb040f6f544124763a2d85f5"


def output(args, cwd, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True).strip()


def check_checkout(path):
    if output(["git", "rev-parse", "HEAD"], path) != COMMIT:
        raise SystemExit("Baseline commit differs; review the source before building.")
    if output(["git", "status", "--porcelain", "--untracked-files=no"], path):
        raise SystemExit("Tracked source changes found; use a separate custom build.")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_artifacts(dest):
    # Arduino injects CRC fields after writing the legacy segment XOR checksum;
    # validate the complete combined image with that core's CRC implementation.
    core = CACHE / "platformio/packages/framework-arduinoespressif8266/tools/elf2bin.py"
    spec = importlib.util.spec_from_file_location("core_elf2bin", core)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = bytearray((dest / "firmware.bin").read_bytes())
    stored_size, stored_crc = struct.unpack_from("<II", data, module.crcsize_offset)
    struct.pack_into("<II", data, module.crcsize_offset, 0, 0)
    if stored_size != len(data) or stored_crc != module.crc8266(data):
        raise SystemExit("Arduino firmware size/CRC validation failed.")

    with tempfile.TemporaryDirectory(prefix="littlefs-verify-", dir=CACHE) as unpacked:
        args = [str(CACHE / "native-mklittlefs/mklittlefs"), "-b", "8192", "-p", "256",
                "-s", "2072576", "-u", unpacked, str(dest / "littlefs.bin")]
        with (dest / "verify-filesystem.log").open("w") as log:
            subprocess.run(args, check=True, stdout=log, stderr=subprocess.STDOUT)
        expected = {p.relative_to(STAGE / "data").as_posix(): sha256(p)
                    for p in (STAGE / "data").rglob("*") if p.is_file()}
        actual = {p.relative_to(unpacked).as_posix(): sha256(p)
                  for p in Path(unpacked).rglob("*") if p.is_file()}
        if actual != expected:
            raise SystemExit("LittleFS round-trip validation failed.")
    result = {"arduino_combined_image_crc_valid": True, "crc32": hex(stored_crc),
              "littlefs_round_trip_file_count": len(expected), "all_file_hashes_match": True,
              "device_runtime_verified": False}
    (dest / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    check_checkout(SOURCE)
    if not PIO.is_file():
        raise SystemExit("PlatformIO environment missing; see docs/BUILDING.md.")
    for tool in [CACHE / "native-toolchain/bin/xtensa-lx106-elf-g++", CACHE / "native-mklittlefs/mklittlefs"]:
        if not tool.is_file():
            raise SystemExit("Native host tool missing; see docs/BUILDING.md: " + str(tool))
    if not STAGE.exists():
        subprocess.run(["git", "clone", "--no-hardlinks", str(SOURCE), str(STAGE)], check=True)
    check_checkout(STAGE)
    shutil.copyfile(ROOT / "tools/platformio-macos.ini", STAGE / "platformio-native.ini")
    # Copy the documented SmallTV example, not the README's nonexistent filename.
    # Credentials stay blank; the API token is the upstream example placeholder.
    config = json.loads((SOURCE / "data/config-smartTV.example").read_text())
    if config["wifi_ssid"] or config["wifi_password"]:
        raise SystemExit("Baseline example must contain no Wi-Fi credentials.")
    (STAGE / "data/config.json").write_text(json.dumps(config, indent=2) + "\n")

    stamp = datetime.datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    dest = ROOT / "firmware" / ("baseline-" + stamp)
    dest.mkdir(parents=True, exist_ok=False)
    env = os.environ.copy()
    env["PLATFORMIO_CORE_DIR"] = str(CACHE / "platformio")
    env["DESKTOP_CLOCK_BUILD_CACHE"] = str(CACHE)
    env["PLATFORMIO_SETTING_ENABLE_TELEMETRY"] = "No"
    for target, filename in [(None, "build-firmware.log"), ("buildfs", "build-filesystem.log")]:
        command = [str(PIO), "run", "-e", "esp12e", "-c", "platformio-native.ini"]
        if target:
            command += ["--target", target]
        print("Local build: " + (target or "firmware"), flush=True)
        with (dest / filename).open("w") as log:
            result = subprocess.run(command, cwd=STAGE, env=env, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise SystemExit("Build failed; see " + str(dest / filename))

    records = []
    for name in ["firmware.bin", "littlefs.bin"]:
        src = STAGE / ".pio/build/esp12e" / name
        dst = dest / name
        shutil.copyfile(src, dst)
        if sha256(src) != sha256(dst):
            raise SystemExit("Artifact copy verification failed: " + name)
        records.append({"file": name, "bytes": dst.stat().st_size, "sha256": sha256(dst)})
    compressed = dest / "firmware.bin.gz"
    compressed.write_bytes(gzip.compress((dest / "firmware.bin").read_bytes(), compresslevel=9, mtime=0))
    if gzip.decompress(compressed.read_bytes()) != (dest / "firmware.bin").read_bytes():
        raise SystemExit("Compressed firmware verification failed.")
    records.append({"file": compressed.name, "bytes": compressed.stat().st_size, "sha256": sha256(compressed)})
    validation = verify_artifacts(dest)

    shutil.copyfile(STAGE / "platformio-native.ini", dest / "platformio-native.ini")
    shutil.copyfile(SOURCE / "LICENSE", dest / "LICENSE")
    resolved = []
    for name in ["build-firmware.log", "build-filesystem.log"]:
        resolved.append(name)
        resolved.extend(line for line in (dest / name).read_text().splitlines()
                        if line.startswith(("PLATFORM:", "PACKAGES:", " - ", "|-- ")))
    (dest / "dependencies.txt").write_text("\n".join(resolved) + "\n")
    manifest = {
        "built_at": datetime.datetime.now().astimezone().isoformat(),
        "repository": "https://github.com/Times-Z/GeekMagic-Open-Firmware",
        "commit": COMMIT,
        "platformio": output([str(PIO), "--version"], STAGE),
        "host_toolchain": "esphome-libs/xtensa-lx106-elf-toolchain 10.3.0-esphome.3, darwin_arm64",
        "host_filesystem_tool": "earlephilhower/mklittlefs 4aca4523e92398cdbdc08027f6dd2ba09ac700fe; LittleFS 2.5 / disk 2.0",
        "environment": "esp12e",
        "source_code_changes": False,
        "filesystem_config": "upstream config-smartTV.example, rotation 0, blank Wi-Fi credentials",
        "flash_assumption": "4 MiB; eagle.flash.4m2m.ld; LittleFS",
        "hardware_compatibility": "unverified",
        "device_flash_performed": False,
        "validation": validation,
        "artifacts": records,
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    (dest / "BUILD-ONLY.txt").write_text(
        "Local compilation only; hardware compatibility and runtime are unverified.\n"
        "No device was flashed. Do not upload littlefs.bin as an application.\n"
        "See ../../docs/BUILDING.md before any device update.\n"
    )
    print("Artifacts saved: " + str(dest), flush=True)


if __name__ == "__main__":
    main()
