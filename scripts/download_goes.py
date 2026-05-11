#!/usr/bin/env python3
"""
Download GOES-19 ABI-L2-CMIPC Channel 13 (.nc) files from the NOAA AWS public bucket.

Files are saved to data/raw/. Files that already exist locally are skipped.
After this script finishes, run:  python scripts/process_goes_to_png.py

Configuration:
  YEAR / DAY_OF_YEAR — the date to pull (2026-05-05 = day 125)
  HOURS              — list of UTC hours to download; each hour has ~12 files
                       (5-minute CONUS scan cadence)
  Change HOURS to list(range(18, 24)) for a full 6-hour window.
"""

from __future__ import annotations

from pathlib import Path

import s3fs

# ── Configuration ─────────────────────────────────────────────────────────────
BUCKET       = "noaa-goes19"
PRODUCT      = "ABI-L2-CMIPC"
YEAR         = 2026
DAY_OF_YEAR  = 125          # May 5, 2026  (day-of-year: 31+28+31+30+5 = 125)
HOURS        = [18, 19, 20] # UTC hours — 3-hour window; add 21,22,23 for 6 hours
CHANNEL      = "M6C13"      # Channel 13, 10.3 µm thermal infrared
RAW_DIR      = Path("data/raw")
# ──────────────────────────────────────────────────────────────────────────────


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    fs = s3fs.S3FileSystem(anon=True, client_kwargs={"region_name": "us-east-1"})

    total_downloaded = 0
    total_skipped    = 0

    for hour in HOURS:
        prefix = f"{BUCKET}/{PRODUCT}/{YEAR}/{DAY_OF_YEAR:03d}/{hour:02d}/"
        print(f"\n── Hour {hour:02d} UTC  →  s3://{prefix}")

        try:
            all_keys = fs.ls(prefix)
        except FileNotFoundError:
            print(f"   No files found at this path — skipping hour {hour:02d}.")
            continue

        channel_files = sorted(k for k in all_keys if CHANNEL in k.split("/")[-1])

        if not channel_files:
            print(f"   No {CHANNEL} files found — skipping.")
            continue

        print(f"   {len(channel_files)} {CHANNEL} file(s) found.")

        for remote_key in channel_files:
            filename   = remote_key.split("/")[-1]
            local_path = RAW_DIR / filename

            if local_path.exists():
                print(f"   [skip]  {filename}")
                total_skipped += 1
                continue

            print(f"   [fetch] {filename}")
            fs.get(remote_key, str(local_path))
            total_downloaded += 1

    print(
        f"\nFinished.  {total_downloaded} file(s) downloaded,"
        f" {total_skipped} already present."
    )
    print(f"All files saved to: {RAW_DIR}/")
    print("Next step:  python scripts/process_goes_to_png.py")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}")
        raise SystemExit(1) from exc
