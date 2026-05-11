# GOES-19 Cloud Top Temperature Explorer
### DSC 106 – Project 3 Final Submission

**Live Site:** `https://Joshuaamm.github.io/DSS106-project3/`

---

## Research Question

**How does cloud top brightness temperature vary spatially and temporally over a one-hour window, and what do these patterns reveal about convective activity?**

---

## Dataset

**NOAA GOES-19 ABI Level-2 Cloud and Moisture Imagery (CMIPC), Channel 13 (10.3 µm thermal IR)**

- Source: [NOAA GOES Open Data Registry on AWS](https://registry.opendata.aws/noaa-goes/)
- Bucket: `s3://noaa-goes19/ABI-L2-CMIPC/2026/125/18/`
- 12 frames, 5-minute intervals, 18:01–18:56 UTC, May 5 2026
- Processed via `scripts/process_goes_to_png.py`

---

## Repo Structure

```
your-repo/
├── index.html                  ← main visualization page
├── main.js                     ← all D3 interaction code
├── style.css                   ← dark satellite-science theme
├── analysis.ipynb              ← exploratory analysis notebook
├── README.md
├── back/                       ← backup of checkpoint files
├── scripts/
│   └── process_goes_to_png.py  ← data pipeline: .nc → PNG + CSV
└── data/
    └── frames/
        ├── frames.json         ← frame metadata + global CMI range
        ├── cloud_summary.csv   ← per-frame mean/min/max CMI (K)
        ├── frame_00.png        ← real GOES-19 satellite imagery
        └── ... frame_11.png
```

---

## Visualization Views

1. **Satellite Frame Viewer** — animate 12 real GOES-19 frames with play/pause and speed control
2. **Scene-Mean Brightness Temperature** — line chart with linked orange marker; click any dot to jump to that frame
3. **Thermal Spread (Min/Max)** — shaded band showing the per-frame temperature range; widening band reveals growing convective activity
4. **Pixel Temperature Distribution** — per-frame histogram that updates live as you scrub through frames

---

## Running the Data Pipeline

To regenerate the PNGs and CSV from raw GOES-19 NetCDF files:

```bash
pip install xarray netcdf4 numpy pandas Pillow

# Download raw .nc files from NOAA S3 (no account needed)
aws s3 sync s3://noaa-goes19/ABI-L2-CMIPC/2026/125/18/ data/raw/ \
  --no-sign-request --exclude "*" --include "*M6C13*"

# Process into PNGs + cloud_summary.csv
python scripts/process_goes_to_png.py
```

---

## Local Development

```bash
# Serve from repo root (required for D3 CSV/JSON loading)
python -m http.server 8000
# Open http://localhost:8000
```

---

## Team
- Ethan Choi
- Joshua Huang
- Bruce Nie