#!/usr/bin/env python3
"""Convert GOES-19 ABI Channel 13 NetCDF files into PNG frames for D3."""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from PIL import Image


RAW_DIR = Path("data/raw")
OUTPUT_DIR = Path("data/frames")
CHANNEL_MARKER = "M6C13"
VARIABLE_NAME = "CMI"

# Pixels with CMI below this threshold (K) are counted as cold (high-altitude) cloud tops.
# 240 K is a standard meteorological threshold for deep convective cloud.
COLD_THRESHOLD = 240.0

# GOES fixed-grid arrays sometimes appear upside-down depending on the viewer.
# If the exported frames look vertically inverted in the D3 site, change this
# value to True and rerun this script.
FLIP_VERTICAL = False


def parse_goes_timestamp(filename: str) -> str | None:
    """Extract the GOES start timestamp from filenames containing _sYYYYJJJHHMMSSd."""
    match = re.search(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})", filename)
    if not match:
        return None

    year, day_of_year, hour, minute, second = match.groups()
    timestamp = pd.to_datetime(
        f"{year}-{day_of_year} {hour}:{minute}:{second}",
        format="%Y-%j %H:%M:%S",
        utc=True,
        errors="coerce",
    )
    if pd.isna(timestamp):
        return None

    return timestamp.strftime("%Y-%m-%d %H:%M UTC")


def load_cmi_array(nc_path: Path) -> np.ndarray:
    """Load CMI from a NetCDF file as a float NumPy array."""
    try:
        with xr.open_dataset(nc_path) as dataset:
            if VARIABLE_NAME not in dataset:
                raise KeyError(f"Missing '{VARIABLE_NAME}' variable")
            return dataset[VARIABLE_NAME].values.astype(np.float32)
    except KeyError:
        raise
    except Exception as exc:
        raise OSError(f"Could not open {nc_path}: {exc}") from exc


def find_global_range(nc_files: list[Path]) -> tuple[float, float]:
    """Find global min and max across all valid CMI pixels."""
    global_min = np.inf
    global_max = -np.inf

    for index, nc_path in enumerate(nc_files, start=1):
        print(f"Scanning {index}/{len(nc_files)}: {nc_path.name}")
        array = load_cmi_array(nc_path)
        valid_values = array[np.isfinite(array)]

        if valid_values.size == 0:
            print(f"Warning: no valid CMI values found in {nc_path.name}")
            continue

        global_min = min(global_min, float(valid_values.min()))
        global_max = max(global_max, float(valid_values.max()))

    if not np.isfinite(global_min) or not np.isfinite(global_max):
        raise ValueError("No valid CMI values were found in any M6C13 file.")

    if global_min == global_max:
        raise ValueError(
            f"Global CMI min and max are both {global_min}; cannot normalize frames."
        )

    return global_min, global_max


def normalize_to_uint8(array: np.ndarray, global_min: float, global_max: float) -> np.ndarray:
    """Normalize CMI values to 0-255 using the shared global range."""
    normalized = (array - global_min) / (global_max - global_min)
    normalized = np.clip(normalized, 0, 1)
    normalized = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=0.0)
    return (normalized * 255).astype(np.uint8)


def main() -> None:
    if not RAW_DIR.exists():
        raise FileNotFoundError(
            f"{RAW_DIR} does not exist. Put raw GOES .nc files in {RAW_DIR}/ first."
        )

    nc_files = sorted(
        path for path in RAW_DIR.glob("*.nc") if CHANNEL_MARKER in path.name
    )
    if not nc_files:
        raise FileNotFoundError(f"No {CHANNEL_MARKER} .nc files found in {RAW_DIR}/.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Found {len(nc_files)} {CHANNEL_MARKER} files.")
    global_min, global_max = find_global_range(nc_files)
    print(f"Global CMI range: min={global_min:.4f}, max={global_max:.4f}")

    frames_metadata = []
    summary_rows = []
    frame_digits = max(2, len(str(len(nc_files) - 1)))

    for index, nc_path in enumerate(nc_files):
        print(f"Processing {index + 1}/{len(nc_files)}: {nc_path.name}")
        array = load_cmi_array(nc_path)

        valid_values = array[np.isfinite(array)]
        if valid_values.size == 0:
            mean_cmi = np.nan
            min_cmi  = np.nan
            max_cmi  = np.nan
            cold_fraction = np.nan
            std_cmi  = np.nan
        else:
            mean_cmi = float(valid_values.mean())
            min_cmi  = float(valid_values.min())
            max_cmi  = float(valid_values.max())
            cold_fraction = float(np.sum(valid_values < COLD_THRESHOLD) / valid_values.size)
            std_cmi  = float(valid_values.std())

        image_array = normalize_to_uint8(array, global_min, global_max)
        if FLIP_VERTICAL:
            image_array = np.flipud(image_array)

        frame_name = f"frame_{index:0{frame_digits}d}.png"
        frame_path = OUTPUT_DIR / frame_name
        Image.fromarray(image_array, mode="L").save(frame_path)
        print(f"Saved {frame_path}")

        timestamp = parse_goes_timestamp(nc_path.name)
        frames_metadata.append(
            {
                "index": index,
                "image": str(frame_path).replace("\\", "/"),
                "source": nc_path.name,
                "timestamp": timestamp,
                "globalMin": global_min,
                "globalMax": global_max,
            }
        )
        summary_rows.append(
            {
                "index": index,
                "timestamp": timestamp,
                "source": nc_path.name,
                "mean_cmi": mean_cmi,
                "min_cmi": min_cmi,
                "max_cmi": max_cmi,
                "cold_fraction_240k": cold_fraction,
                "std_cmi": std_cmi,
            }
        )

    frames_json_path = OUTPUT_DIR / "frames.json"
    frames_json_path.write_text(json.dumps(frames_metadata, indent=2), encoding="utf-8")
    print(f"Saved {frames_json_path}")

    summary_csv_path = OUTPUT_DIR / "cloud_summary.csv"
    pd.DataFrame(summary_rows).to_csv(summary_csv_path, index=False)
    print(f"Saved {summary_csv_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}")
        raise SystemExit(1) from exc
