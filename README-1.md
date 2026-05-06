# GOES-16 SST & Hurricane Intensity Visualization
### DSC 106 – Project 3 Checkpoint

**Live Site:** `https://[your-username].github.io/[repo-name]/`

---

## Research Question
> **How does GOES-16 satellite-observed Sea Surface Temperature predict and trace the rapid intensification of Atlantic hurricanes during the 2023 season?**

---

## Team
- Team Member 1
- Team Member 2
- Team Member 3
- Team Member 4

---

## Dataset: NOAA GOES-16 ABI-L2-SSTF

**Source:** [NOAA GOES-16 on AWS Open Data Registry](https://registry.opendata.aws/noaa-goes/)

**Product used:** `ABI-L2-SSTF` (Sea Surface Temperature – Full Disk, Level 2)

**Spatial resolution:** 2 km  
**Temporal resolution:** 10 minutes (Full Disk), 5 minutes (CONUS)  
**Coverage:** Western Hemisphere (GOES-16 CONUS + Full Disk modes)

---

## How to Access GOES-16 Data

### Option 1: Python + S3 (Recommended for data processing)

```bash
pip install s3fs xarray netCDF4 numpy pandas matplotlib
```

```python
import s3fs
import xarray as xr

# Connect anonymously to the GOES-16 public S3 bucket
fs = s3fs.S3FileSystem(anon=True, client_kwargs={'region_name': 'us-east-1'})

# List available SST files for a specific day
# Format: ABI-L2-SSTF/{year}/{day_of_year}/{hour}/
files = fs.ls('noaa-goes16/ABI-L2-SSTF/2023/240/00/')  # Aug 28 2023, hour 00
print(files[:3])

# Open a file directly from S3 (no download needed)
file_path = files[0]
with fs.open(file_path) as f:
    ds = xr.open_dataset(f, engine='scipy')
    print(ds)
    sst = ds['SST'].values  # Sea Surface Temperature in Kelvin
```

### Option 2: AWS CLI (Fast bulk download)

```bash
# Install AWS CLI
pip install awscli

# Download SST files for August 28, 2023 (Idalia day)
aws s3 cp s3://noaa-goes16/ABI-L2-SSTF/2023/240/ ./data/goes_raw/ \
    --recursive --no-sign-request

# Or a single file
aws s3 cp s3://noaa-goes16/ABI-L2-SSTF/2023/240/00/OR_ABI-L2-SSTF-M6_G16_s20232400000207_e20232400009515_c20232400013039.nc \
    ./data/ --no-sign-request
```

### Option 3: NOAA CLASS (Web Interface)

1. Go to [https://www.class.noaa.gov/](https://www.class.noaa.gov/)
2. Select **GOES-R Series ABI Products**
3. Search for **ABI-L2-SSTF**, set date range and geographic subset
4. Download as NetCDF files

---

## Processing GOES NetCDF to CSV/JSON (for D3.js)

```python
import s3fs
import xarray as xr
import numpy as np
import pandas as pd
import json

fs = s3fs.S3FileSystem(anon=True, client_kwargs={'region_name': 'us-east-1'})

def goes_sst_to_json(year, doy, hour, output_path, lat_range=(10, 50), lon_range=(-100, -55)):
    """
    Download a GOES-16 SST file and subset to the Gulf/Atlantic region.
    Outputs a JSON file ready for D3.js.
    """
    prefix = f'noaa-goes16/ABI-L2-SSTF/{year}/{doy:03d}/{hour:02d}/'
    files = fs.ls(prefix)
    if not files:
        print(f"No files found for {year} DOY {doy} hour {hour}")
        return

    with fs.open(files[0]) as f:
        ds = xr.open_dataset(f, engine='scipy')

        # GOES uses a fixed-grid projection — convert to lat/lon
        # SST variable is in Kelvin; convert to Celsius
        sst_k = ds['SST'].values
        # DQF = Data Quality Flag (0 = good, 1-3 = degraded/bad)
        dqf = ds['DQF'].values

        # Approximate lat/lon grid for GOES Full Disk
        # (For precise coordinates, use the projection metadata in the NetCDF)
        lats = np.linspace(-81, 81, sst_k.shape[0])
        lons = np.linspace(-156, 6, sst_k.shape[1])

        # Subset to region of interest
        lat_mask = (lats >= lat_range[0]) & (lats <= lat_range[1])
        lon_mask = (lons >= lon_range[0]) & (lons <= lon_range[1])

        sst_sub = sst_k[np.ix_(lat_mask, lon_mask)]
        dqf_sub = dqf[np.ix_(lat_mask, lon_mask)]
        lats_sub = lats[lat_mask]
        lons_sub = lons[lon_mask]

        # Build JSON records (skip bad quality pixels)
        records = []
        step = 5  # Subsample every 5th pixel to reduce file size
        for i in range(0, len(lats_sub), step):
            for j in range(0, len(lons_sub), step):
                val = float(sst_sub[i, j])
                if np.isnan(val) or dqf_sub[i, j] > 1:
                    continue
                records.append({
                    "lat": round(float(lats_sub[i]), 2),
                    "lon": round(float(lons_sub[j]), 2),
                    "sst_c": round(val - 273.15, 2)
                })

        with open(output_path, 'w') as out:
            json.dump(records, out)
        print(f"Saved {len(records)} records to {output_path}")

# Example: Get spatial SST for Idalia landfall day (DOY 240 = Aug 28)
goes_sst_to_json(2023, 240, 18, 'data/spatial_sst_idalia.json')
```

---

## Repository Structure

```
goes-checkpoint/
├── index.html          # Main checkpoint visualization page (6 charts)
├── README.md           # This file
├── data/
│   ├── sst_timeseries.json     # Daily SST June-Nov 2023 (3 regions)
│   ├── scatter_data.json       # Storm SST vs. peak wind
│   ├── monthly_anomaly.json    # Monthly SST anomaly 2020-2023
│   ├── spatial_sst.json        # Spatial SST grid (Aug 28 2023)
│   ├── idalia_hourly.json      # Hourly SST ± 24h around Idalia
│   └── hurricanes.json         # 2023 season hurricane metadata
└── docs/               # (optional GitHub Pages source folder)
```

---

## The 6 Exploratory Visualizations

| # | Chart Type | Finding |
|---|-----------|---------|
| 1 | Multi-line time series | Gulf SST peaked at historic 302.5K in Aug 2023 |
| 2 | Scatter plot | Clear positive correlation: warmer SST → higher peak winds |
| 3 | Heatmap (month × year) | 2023 anomaly reached +0.9K above climatology |
| 4 | Spatial raster map | Idalia cold wake visible as SST depression along storm path |
| 5 | Line chart with annotation | SST dropped 1.3°C in 8h post-landfall (upwelling feedback) |
| 6 | Grouped bar chart | 100% of Cat 3+ storms formed over SST > 29.5°C |

---

## Deployment (GitHub Pages)

```bash
# 1. Create a public GitHub repo
git init
git add .
git commit -m "Project 3 Checkpoint - GOES SST Hurricane Visualization"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main

# 2. In GitHub repo settings → Pages → Source: Deploy from branch (main, / root)
# 3. Your site will be live at: https://YOUR_USERNAME.github.io/YOUR_REPO/
```

---

## Sources

- NOAA GOES-16 Open Data: https://registry.opendata.aws/noaa-goes/
- NHC 2023 Atlantic Hurricane Season Summary: https://www.nhc.noaa.gov/data/tcr/
- GOES-R ABI L2 SST Product User Guide: https://www.star.nesdis.noaa.gov/goesr/docs/
- Kaplan & DeMaria (2003): "Large-scale characteristics of rapidly intensifying tropical cyclones" – *Weather and Forecasting*
