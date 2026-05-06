/* ═══════════════════════════════════════════════════════════════════
   main.js  —  GOES-19 Channel 13 Cloud Time-Lapse Explorer
   DSC 106 Project 3

   Sections:
     A. Data loading  (Promise.all for frames.json + cloud_summary.csv)
     B. §1 Frame grid
     C. §2 Mean CMI line chart
     D. §3 Min/Max range chart
     E. §4 Interactive timelapse (slider, play/pause, thumbnails,
            linked chart, details panel)
     F. §5 Early vs. late comparison
     G. §6 Full metadata table

   Image paths: frames.json stores  "data/frames/frame_XX.png"
   which works correctly when index.html is at the repo root.
   ═══════════════════════════════════════════════════════════════════ */

// ─── A. Load data ─────────────────────────────────────────────────
Promise.all([
  d3.json("data/frames/frames.json"),
  d3.csv("data/frames/cloud_summary.csv", d3.autoType)
]).then(([frames, summary]) => {

  // summary rows have: index, timestamp, source, mean_cmi, min_cmi, max_cmi
  // frames rows have:  index, image, source, timestamp, globalMin, globalMax

  // Merge summary stats into the frames array for convenience
  const statsMap = new Map(summary.map(s => [s.index, s]));
  frames.forEach(f => {
    const s = statsMap.get(f.index) || {};
    f.mean_cmi = s.mean_cmi;
    f.min_cmi  = s.min_cmi;
    f.max_cmi  = s.max_cmi;
  });

  // Shared tooltip element (reused by all charts)
  const tooltip = d3.select("#tooltip");

  function showTip(html, event) {
    tooltip.html(html)
      .classed("visible", true)
      .style("left", (event.clientX + 14) + "px")
      .style("top",  (event.clientY - 10) + "px");
  }
  function hideTip() { tooltip.classed("visible", false); }

  // ─── B. §1  Frame Grid ─────────────────────────────────────────
  const grid = d3.select("#frame-grid");

  frames.forEach(f => {
    const div = grid.append("div")
      .attr("class", "grid-frame")
      .on("click", () => setFrame(f.index));  // clicking jumps viewer

    div.append("img")
      .attr("src", f.image)
      .attr("alt", `Frame ${f.index} — ${f.timestamp}`);

    div.append("div")
      .attr("class", "grid-label")
      .text(`${String(f.index).padStart(2,"0")} · ${f.timestamp.replace(" UTC","")}`);
  });

  // ─── C. §2  Mean CMI Line Chart ────────────────────────────────
  buildMeanChart(frames, tooltip, showTip, hideTip);

  // ─── D. §3  Min/Max Range Chart ────────────────────────────────
  buildRangeChart(frames, tooltip, showTip, hideTip);

  // ─── E. §4  Interactive Timelapse ─────────────────────────────
  let currentFrame = 0;
  let playTimer = null;   // holds d3.interval when playing
  const PLAY_INTERVAL_MS = 700;

  // Populate slider endpoints
  d3.select("#t-start").text(frames[0].timestamp.replace(" UTC",""));
  d3.select("#t-end").text(frames[frames.length-1].timestamp.replace(" UTC",""));

  // Build thumbnail strip
  const strip = d3.select("#thumb-strip");
  frames.forEach(f => {
    const div = strip.append("div")
      .attr("class", "thumb")
      .attr("id", `thumb-${f.index}`)
      .on("click", () => setFrame(f.index));
    div.append("img").attr("src", f.image).attr("alt", `Frame ${f.index}`);
  });

  // Build the small linked chart inside the sidebar
  const linkedChartSel = buildLinkedChart(frames, tooltip, showTip, hideTip);

  // setFrame: master function that updates everything
  function setFrame(idx) {
    currentFrame = Math.max(0, Math.min(frames.length - 1, idx));
    const f = frames[currentFrame];

    // Update main image
    d3.select("#main-frame").attr("src", f.image);

    // Update badge
    d3.select("#frame-badge")
      .text(`Frame ${String(currentFrame).padStart(2,"0")} · ${f.timestamp}`);

    // Update slider
    d3.select("#frame-slider").property("value", currentFrame);

    // Update thumbnails
    d3.selectAll(".thumb").classed("active", (d, i, nodes) => {
      return +nodes[i].id.split("-")[1] === currentFrame;
    });

    // Update linked chart marker
    updateLinkedMarker(currentFrame, frames);

    // Update details panel
    updateDetails(f);

    // Highlight active row in metadata table
    d3.selectAll(".meta-table tbody tr")
      .classed("active-row", (d, i) => i === currentFrame);

    // Scroll active thumb into view
    const thumbEl = document.getElementById(`thumb-${currentFrame}`);
    if (thumbEl) thumbEl.scrollIntoView({ inline: "nearest", behavior: "smooth" });
  }

  // Slider input event
  d3.select("#frame-slider").on("input", function() {
    setFrame(+this.value);
  });

  // Prev / Next buttons
  d3.select("#btn-prev").on("click", () => setFrame(currentFrame - 1));
  d3.select("#btn-next").on("click", () => setFrame(currentFrame + 1));

  // Play / Pause
  d3.select("#btn-play").on("click", function() {
    if (playTimer) {
      // Currently playing → pause
      playTimer.stop();
      playTimer = null;
      d3.select(this).text("▶ Play").classed("paused", true);
    } else {
      // Currently paused → play
      d3.select(this).html("&#9646;&#9646; Pause").classed("paused", false);
      playTimer = d3.interval(() => {
        const next = (currentFrame + 1) % frames.length;
        setFrame(next);
        // Auto-stop after looping once back to 0
        if (next === 0) {
          playTimer.stop();
          playTimer = null;
          d3.select("#btn-play").text("▶ Play").classed("paused", true);
        }
      }, PLAY_INTERVAL_MS);
    }
  });

  // Initialize viewer on frame 0
  setFrame(0);

  // ─── F. §5  Early vs. Late Comparison ────────────────────────
  const first = frames[0];
  const last  = frames[frames.length - 1];

  d3.select("#cmp-early").attr("src", first.image);
  d3.select("#lbl-early")
    .text(`Frame 00 · ${first.timestamp} · mean ${first.mean_cmi.toFixed(2)} K`);

  d3.select("#cmp-late").attr("src", last.image);
  d3.select("#lbl-late")
    .text(`Frame 11 · ${last.timestamp} · mean ${last.mean_cmi.toFixed(2)} K`);

  // Stat cards
  const stats = [
    {
      label: "Mean CMI shift",
      val: (last.mean_cmi - first.mean_cmi).toFixed(3) + " K",
      sub: "Frame 00 → Frame 11"
    },
    {
      label: "Max CMI change",
      val: "+" + (last.max_cmi - first.max_cmi).toFixed(2) + " K",
      sub: "Warmer surface pixels growing"
    },
    {
      label: "Min CMI change",
      val: (last.min_cmi - first.min_cmi).toFixed(2) + " K",
      sub: "Cold cloud top variation"
    },
    {
      label: "CMI range (last frame)",
      val: (last.max_cmi - last.min_cmi).toFixed(1) + " K",
      sub: "vs " + (first.max_cmi - first.min_cmi).toFixed(1) + " K first frame"
    }
  ];

  const statWrap = d3.select("#compare-stats");
  stats.forEach(s => {
    const card = statWrap.append("div").attr("class", "stat-card");
    card.append("div").attr("class", "stat-label").text(s.label);
    card.append("div").attr("class", "stat-val").text(s.val);
    card.append("div").attr("class", "stat-sub").text(s.sub);
  });

  // ─── G. §6  Full Metadata Table ───────────────────────────────
  const tableWrap = d3.select("#metadata-table-wrap");
  const table = tableWrap.append("table").attr("class", "meta-table");

  table.append("thead").append("tr")
    .selectAll("th")
    .data(["#", "Timestamp", "Mean CMI (K)", "Min CMI (K)", "Max CMI (K)", "Source File"])
    .join("th")
    .text(d => d);

  const tbody = table.append("tbody");
  const rows = tbody.selectAll("tr")
    .data(frames)
    .join("tr")
    .on("click", (event, d) => {
      setFrame(d.index);
      // Scroll to timelapse section
      document.getElementById("sec-timelapse").scrollIntoView({ behavior: "smooth" });
    });

  rows.append("td").attr("class", "td-ts")
    .text(d => String(d.index).padStart(2, "0"));
  rows.append("td").attr("class", "td-ts")
    .text(d => d.timestamp);
  rows.append("td").attr("class", "td-num")
    .text(d => d.mean_cmi.toFixed(3));
  rows.append("td").attr("class", "td-num")
    .text(d => d.min_cmi.toFixed(2));
  rows.append("td").attr("class", "td-num")
    .text(d => d.max_cmi.toFixed(2));
  rows.append("td").attr("class", "td-src")
    .text(d => d.source);

}); // end Promise.all


/* ═══════════════════════════════════════════════════════════════════
   Chart helper functions
   ═══════════════════════════════════════════════════════════════════ */

// ─── buildMeanChart  (§2) ──────────────────────────────────────────
function buildMeanChart(frames, tooltip, showTip, hideTip) {
  const margin = { top: 24, right: 24, bottom: 44, left: 62 };
  const totalW = document.getElementById("sec-mean").clientWidth - 80;
  const W = Math.max(totalW, 400);
  const H = 260;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const svg = d3.select("#mean-chart")
    .append("svg")
    .attr("class", "chart-svg-wrap")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("style", "max-width:100%;height:auto;");

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Scales
  const x = d3.scaleLinear()
    .domain([0, frames.length - 1])
    .range([0, iW]);

  // Zoom in on the actual data range (it's very tight: ~279.37–279.41)
  const yPad = 0.02;
  const yMin = d3.min(frames, d => d.mean_cmi) - yPad;
  const yMax = d3.max(frames, d => d.mean_cmi) + yPad;

  const y = d3.scaleLinear()
    .domain([yMin, yMax])
    .range([iH, 0])
    .nice();

  // Grid lines
  g.append("g").attr("class", "grid-line")
    .call(d3.axisLeft(y).tickSize(-iW).tickFormat(""));

  // Axes
  const xAxis = d3.axisBottom(x)
    .tickValues(d3.range(0, frames.length))
    .tickFormat(i => frames[i] ? frames[i].timestamp.replace("2026-05-05 ","").replace(" UTC","") : "");

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(xAxis)
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end")
    .attr("dx", "-0.4em")
    .attr("dy", "0.2em");

  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));

  // Y-axis label
  g.append("text").attr("class", "chart-y-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -48)
    .attr("text-anchor", "middle")
    .text("MEAN CMI (K)");

  // Area under the line
  const areaGen = d3.area()
    .x((d, i) => x(i))
    .y0(iH)
    .y1(d => y(d.mean_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "area-fill")
    .attr("d", areaGen);

  // Line
  const lineGen = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.mean_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "line-mean")
    .attr("d", lineGen);

  // Dots with hover tooltip
  g.selectAll(".dot")
    .data(frames)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", (d, i) => x(i))
    .attr("cy", d => y(d.mean_cmi))
    .attr("r", 4)
    .on("mousemove", (event, d) => {
      showTip(
        `<span class="tt-label">${d.timestamp}</span><br>` +
        `Mean CMI: <strong>${d.mean_cmi.toFixed(4)} K</strong>`,
        event
      );
    })
    .on("mouseleave", hideTip);
}


// ─── buildRangeChart  (§3) ────────────────────────────────────────
function buildRangeChart(frames, tooltip, showTip, hideTip) {
  const margin = { top: 24, right: 24, bottom: 44, left: 62 };
  const totalW = document.getElementById("sec-range").clientWidth - 80;
  const W = Math.max(totalW, 400);
  const H = 280;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const svg = d3.select("#range-chart")
    .append("svg")
    .attr("class", "chart-svg-wrap")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("style", "max-width:100%;height:auto;");

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Scales
  const x = d3.scaleLinear().domain([0, frames.length - 1]).range([0, iW]);
  const y = d3.scaleLinear()
    .domain([
      d3.min(frames, d => d.min_cmi) - 1,
      d3.max(frames, d => d.max_cmi) + 1
    ])
    .range([iH, 0])
    .nice();

  // Grid
  g.append("g").attr("class", "grid-line")
    .call(d3.axisLeft(y).tickSize(-iW).tickFormat(""));

  // Axes
  const xAxis = d3.axisBottom(x)
    .tickValues(d3.range(0, frames.length))
    .tickFormat(i => frames[i] ? frames[i].timestamp.replace("2026-05-05 ","").replace(" UTC","") : "");

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(xAxis)
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end")
    .attr("dx", "-0.4em")
    .attr("dy", "0.2em");

  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));

  // Y-axis label
  g.append("text").attr("class", "chart-y-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -iH / 2).attr("y", -48)
    .attr("text-anchor", "middle")
    .text("CMI (K)");

  // Shaded area between min and max
  const areaGen = d3.area()
    .x((d, i) => x(i))
    .y0(d => y(d.min_cmi))
    .y1(d => y(d.max_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "area-fill")
    .attr("d", areaGen);

  // Max line (cyan)
  const lineMax = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.max_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "line-max")
    .attr("d", lineMax);

  // Min line (orange dashed)
  const lineMin = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.min_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "line-min")
    .attr("d", lineMin);

  // Hover dots for max
  g.selectAll(".dot-max")
    .data(frames)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", (d, i) => x(i))
    .attr("cy", d => y(d.max_cmi))
    .attr("r", 3.5)
    .on("mousemove", (event, d) => {
      showTip(
        `<span class="tt-label">${d.timestamp}</span><br>` +
        `Max CMI: <strong>${d.max_cmi.toFixed(2)} K</strong><br>` +
        `Min CMI: <strong>${d.min_cmi.toFixed(2)} K</strong><br>` +
        `Range: <strong>${(d.max_cmi - d.min_cmi).toFixed(2)} K</strong>`,
        event
      );
    })
    .on("mouseleave", hideTip);

  // Legend
  const legData = [
    { label: "Max CMI (warmest pixels)",  cls: "line-max",  dash: false },
    { label: "Min CMI (coldest cloud tops)", cls: "line-min", dash: true }
  ];
  const leg = g.append("g").attr("transform", `translate(${iW - 220}, 6)`);
  legData.forEach((ld, i) => {
    const row = leg.append("g").attr("transform", `translate(0, ${i * 18})`);
    row.append("line")
      .attr("x1", 0).attr("y1", 7).attr("x2", 22).attr("y2", 7)
      .attr("class", ld.cls)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", ld.dash ? "5 3" : "none");
    row.append("text")
      .attr("x", 28).attr("y", 11)
      .attr("fill", "var(--text-muted)")
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", "10")
      .text(ld.label);
  });
}


// ─── buildLinkedChart  (sidebar in §4) ────────────────────────────
// Returns a function to update the moving marker
function buildLinkedChart(frames, tooltip, showTip, hideTip) {
  const margin = { top: 16, right: 16, bottom: 36, left: 52 };
  const W = 288;
  const H = 170;
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top  - margin.bottom;

  const container = d3.select("#linked-chart");
  container.style("background", "var(--surface)")
           .style("border", "1px solid var(--border)")
           .style("border-radius", "var(--radius-lg)")
           .style("padding", "2px 0 0");

  // Small label
  container.append("div")
    .style("font-size", "10px")
    .style("color", "var(--text-muted)")
    .style("padding", "8px 14px 0")
    .style("letter-spacing", "0.08em")
    .text("MEAN CMI (K) — ACTIVE FRAME ↓");

  const svg = container.append("svg")
    .attr("width", W)
    .attr("height", H)
    .attr("style", "max-width:100%;");

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Scales — zoom into the tight mean_cmi range
  const x = d3.scaleLinear().domain([0, frames.length - 1]).range([0, iW]);
  const yPad = 0.025;
  const y = d3.scaleLinear()
    .domain([
      d3.min(frames, d => d.mean_cmi) - yPad,
      d3.max(frames, d => d.mean_cmi) + yPad
    ])
    .range([iH, 0]);

  // Minimal axes
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x)
      .tickValues([0, 3, 6, 9, 11])
      .tickFormat(i => frames[i] ? frames[i].timestamp.replace("2026-05-05 18:","").replace(" UTC","") + "h" : "")
    )
    .selectAll("text")
      .attr("font-size", "9");

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(4).tickFormat(d => d.toFixed(2)))
    .selectAll("text").attr("font-size", "9");

  // Area + line
  const areaGen = d3.area()
    .x((d, i) => x(i)).y0(iH).y1(d => y(d.mean_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path").datum(frames).attr("class", "area-fill").attr("d", areaGen);

  const lineGen = d3.line()
    .x((d, i) => x(i)).y(d => y(d.mean_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path").datum(frames).attr("class", "line-mean").attr("d", lineGen);

  // Static dots
  g.selectAll(".dot")
    .data(frames)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", (d, i) => x(i))
    .attr("cy", d => y(d.mean_cmi))
    .attr("r", 3)
    .on("mousemove", (event, d) => {
      showTip(
        `<span class="tt-label">${d.timestamp}</span><br>` +
        `Mean CMI: <strong>${d.mean_cmi.toFixed(4)} K</strong>`,
        event
      );
    })
    .on("mouseleave", hideTip)
    .on("click", (event, d) => {
      // Clicking a dot in the linked chart also updates the viewer
      window._setFrame && window._setFrame(d.index);
    });

  // Moving marker: vertical line + orange dot
  const markerLine = g.append("line")
    .attr("class", "marker-line")
    .attr("y1", 0).attr("y2", iH);

  const markerDot = g.append("circle")
    .attr("class", "marker-dot-linked")
    .attr("r", 5);

  // Expose update function on window so setFrame can call it
  window._updateLinkedMarker = function(idx) {
    const xPos = x(idx);
    const yPos = y(frames[idx].mean_cmi);
    markerLine.attr("x1", xPos).attr("x2", xPos);
    markerDot.attr("cx", xPos).attr("cy", yPos);
  };

  window._updateLinkedMarker(0);
}


// ─── updateLinkedMarker ───────────────────────────────────────────
function updateLinkedMarker(idx, frames) {
  if (window._updateLinkedMarker) window._updateLinkedMarker(idx);
}


// ─── updateDetails  (details panel in §4) ─────────────────────────
function updateDetails(f) {
  const tbody = d3.select("#details-table tbody");
  tbody.html(""); // clear

  const rows = [
    ["Frame",     String(f.index).padStart(2, "0")],
    ["Time",      f.timestamp],
    ["Mean CMI",  f.mean_cmi.toFixed(3) + " K"],
    ["Min CMI",   f.min_cmi.toFixed(2)  + " K"],
    ["Max CMI",   f.max_cmi.toFixed(2)  + " K"],
    ["Range",     (f.max_cmi - f.min_cmi).toFixed(2) + " K"],
    ["Global min",f.globalMin.toFixed(2) + " K"],
    ["Global max",f.globalMax.toFixed(2) + " K"],
    ["Source",    f.source.replace(/^OR_ABI-L2-CMIPC-/,"")]
  ];

  rows.forEach(([label, val]) => {
    const tr = tbody.append("tr");
    tr.append("td").text(label);
    const td = tr.append("td").text(val);
    // Highlight timestamp and mean values
    if (label === "Time" || label === "Mean CMI") {
      td.classed("detail-accent", true);
    }
  });
}
