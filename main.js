/* ================================================================
   main.js – GOES-19 Cloud Temperature Explorer
   DSC 106 Project 3 – Final Submission

   Data (real GOES-19 satellite data):
     data/frames/frames.json       — 12 frame metadata + global CMI range
     data/frames/cloud_summary.csv — per-frame mean/min/max CMI in Kelvin

   Views:
     1. Satellite frame viewer — slider, play/pause, speed control
     2. Mean CMI line chart — linked marker, click dot to jump frame
     3. Min/Max thermal spread — shaded band, hover tooltips
     4. Min vs Mean scatter plot — one dot per frame, reveals convective relationship
     5. Frame details panel
   ================================================================ */

"use strict";

// ── Tooltip ──────────────────────────────────────────────────────
const tooltip = d3.select("#tooltip");
function showTip(html, event) {
  tooltip.html(html)
    .classed("visible", true)
    .style("left", (event.clientX + 16) + "px")
    .style("top",  (event.clientY - 12) + "px");
}
function hideTip() { tooltip.classed("visible", false); }

// ── Global state ─────────────────────────────────────────────────
let currentFrame     = 0;
let playTimer        = null;
let playSpeed        = 700;
let allFrames        = [];
let updateMeanMarker = () => {};
let updateScatter    = () => {};

// ================================================================
// BOOTSTRAP — load real data files
// ================================================================
Promise.all([
  d3.json("data/frames/frames.json"),
  d3.csv("data/frames/cloud_summary.csv", d3.autoType),
]).then(([framesRaw, summary]) => {

  // Merge per-frame stats into frame objects
  const statsMap = new Map(summary.map(s => [s.index, s]));
  framesRaw.forEach(f => {
    const s    = statsMap.get(f.index) || {};
    f.mean_cmi = s.mean_cmi;
    f.min_cmi  = s.min_cmi;
    f.max_cmi  = s.max_cmi;
  });

  allFrames = framesRaw;

  // Build all views
  updateMeanMarker = buildMeanChart();
  buildRangeChart();
  updateScatter    = buildScatter();
  initViewer();
  setFrame(0);

}).catch(err => {
  console.error("Data load error:", err);
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    `<p style="color:#f87171;font-family:monospace;padding:20px;">
      Error loading data: ${err.message}
    </p>`
  );
});

// ================================================================
// setFrame — single source of truth, keeps all views in sync
// ================================================================
function setFrame(idx) {
  currentFrame = Math.max(0, Math.min(allFrames.length - 1, idx));
  const f = allFrames[currentFrame];

  d3.select("#main-frame").attr("src", f.image);
  d3.select("#frame-badge")
    .text("Frame " + String(currentFrame).padStart(2, "0") + " · " + f.timestamp);
  d3.select("#frame-slider").property("value", currentFrame);
  d3.select("#slider-val").text(currentFrame + " / " + (allFrames.length - 1));

  updateMeanMarker(currentFrame);
  updateScatter(currentFrame);
  updateDetails(f);
}

// ================================================================
// VIEW 2: Scene-mean CMI line chart
// Transformation: scene-average of all valid CONUS pixels per frame
// ================================================================
function buildMeanChart() {
  const M  = { top: 28, right: 24, bottom: 52, left: 62 };
  const TW = Math.min(920, window.innerWidth - 52);
  const TH = 230;
  const W  = TW - M.left - M.right;
  const H  = TH - M.top  - M.bottom;

  const svg = d3.select("#mean-chart")
    .append("svg").attr("width", TW).attr("height", TH);
  const g = svg.append("g")
    .attr("transform", `translate(${M.left},${M.top})`);

  const x = d3.scaleLinear()
    .domain([0, allFrames.length - 1]).range([0, W]);

  const yPad = 0.03;
  const y = d3.scaleLinear()
    .domain([
      d3.min(allFrames, d => d.mean_cmi) - yPad,
      d3.max(allFrames, d => d.mean_cmi) + yPad
    ])
    .range([H, 0]);

  // Grid
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(4).tickSize(-W).tickFormat(""));

  // X axis with time labels
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H})`)
    .call(
      d3.axisBottom(x)
        .tickValues(d3.range(0, allFrames.length))
        .tickFormat(i => allFrames[i]
          ? allFrames[i].timestamp.replace("2026-05-05 ", "").replace(" UTC", "")
          : "")
    )
    .selectAll("text")
      .attr("transform", "rotate(-35)")
      .style("text-anchor", "end")
      .attr("dx", "-0.3em").attr("dy", "0.15em");

  // Y axis
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(4).tickFormat(d => d.toFixed(2)));

  // Y label
  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -H / 2).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--text3)")
    .attr("font-size", "10px").attr("font-family", "var(--font-mono)")
    .text("Mean Brightness Temp (K)");

  // Annotate coldest mean frame
  const coldestIdx = d3.minIndex(allFrames, d => d.mean_cmi);
  g.append("line")
    .attr("x1", x(coldestIdx)).attr("x2", x(coldestIdx))
    .attr("y1", 0).attr("y2", H)
    .attr("stroke", "var(--accent2)").attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "4 3").attr("opacity", 0.8);
  g.append("text")
    .attr("x", x(coldestIdx) + 5).attr("y", 14)
    .attr("fill", "var(--accent2)").attr("font-size", "10px")
    .attr("font-family", "var(--font-mono)")
    .text("↓ coldest scene mean");

  // Line
  g.append("path").datum(allFrames).attr("class", "line-mean")
    .attr("d", d3.line()
      .x((d, i) => x(i)).y(d => y(d.mean_cmi))
      .curve(d3.curveMonotoneX));

  // Dots — clickable to jump frame
  g.selectAll(".dot").data(allFrames).join("circle")
    .attr("class", "dot").attr("r", 5)
    .attr("cx", (d, i) => x(i)).attr("cy", d => y(d.mean_cmi))
    .on("mousemove", (event, d) => showTip(
      `${d.timestamp}<br>Mean CMI: <b>${d.mean_cmi.toFixed(4)} K</b><br>
       <span style="font-size:10px;color:#8a99b8">Click to load this frame</span>`,
      event))
    .on("mouseleave", hideTip)
    .on("click", (event, d) => setFrame(d.index));

  // Moving marker (orange vertical line + dot)
  const markerLine = g.append("line").attr("class", "marker-line")
    .attr("y1", 0).attr("y2", H);
  const markerDot = g.append("circle").attr("class", "marker-dot").attr("r", 7);

  function updateMarker(idx) {
    markerLine.attr("x1", x(idx)).attr("x2", x(idx));
    markerDot.attr("cx", x(idx)).attr("cy", y(allFrames[idx].mean_cmi));
  }
  updateMarker(0);
  return updateMarker;
}

// ================================================================
// VIEW 3: Min/Max thermal spread range chart
// Transformation: per-frame min and max of all valid CONUS pixels
// ================================================================
function buildRangeChart() {
  const M  = { top: 28, right: 24, bottom: 52, left: 62 };
  const TW = Math.min(920, window.innerWidth - 52);
  const TH = 230;
  const W  = TW - M.left - M.right;
  const H  = TH - M.top  - M.bottom;

  const svg = d3.select("#range-chart")
    .append("svg").attr("width", TW).attr("height", TH);
  const g = svg.append("g")
    .attr("transform", `translate(${M.left},${M.top})`);

  const x = d3.scaleLinear()
    .domain([0, allFrames.length - 1]).range([0, W]);
  const y = d3.scaleLinear()
    .domain([
      d3.min(allFrames, d => d.min_cmi) - 2,
      d3.max(allFrames, d => d.max_cmi) + 2
    ])
    .range([H, 0]);

  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-W).tickFormat(""));

  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H})`)
    .call(
      d3.axisBottom(x)
        .tickValues(d3.range(0, allFrames.length))
        .tickFormat(i => allFrames[i]
          ? allFrames[i].timestamp.replace("2026-05-05 ", "").replace(" UTC", "")
          : "")
    )
    .selectAll("text")
      .attr("transform", "rotate(-35)").style("text-anchor", "end")
      .attr("dx", "-0.3em").attr("dy", "0.15em");

  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));

  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -H / 2).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--text3)")
    .attr("font-size", "10px").attr("font-family", "var(--font-mono)")
    .text("Brightness Temp (K)");

  // Shaded band between min and max
  g.append("path").datum(allFrames).attr("class", "area-range")
    .attr("d", d3.area()
      .x((d, i) => x(i)).y0(d => y(d.min_cmi)).y1(d => y(d.max_cmi))
      .curve(d3.curveMonotoneX));

  // Max line (blue)
  g.append("path").datum(allFrames).attr("class", "line-max")
    .attr("d", d3.line()
      .x((d, i) => x(i)).y(d => y(d.max_cmi)).curve(d3.curveMonotoneX));

  // Min line (red dashed)
  g.append("path").datum(allFrames).attr("class", "line-min")
    .attr("d", d3.line()
      .x((d, i) => x(i)).y(d => y(d.min_cmi)).curve(d3.curveMonotoneX));

  // Hover dots
  g.selectAll(".rdot").data(allFrames).join("circle")
    .attr("class", "dot").attr("r", 4)
    .attr("cx", (d, i) => x(i)).attr("cy", d => y(d.max_cmi))
    .on("mousemove", (event, d) => showTip(
      `${d.timestamp}<br>` +
      `Max: <b>${d.max_cmi.toFixed(2)} K</b><br>` +
      `Min: <b>${d.min_cmi.toFixed(2)} K</b><br>` +
      `Spread: <b>${(d.max_cmi - d.min_cmi).toFixed(2)} K</b>`,
      event))
    .on("mouseleave", hideTip);

  // Legend
  const leg = g.append("g").attr("transform", `translate(${W - 185}, 4)`);
  leg.append("line").attr("x1",0).attr("y1",8).attr("x2",18).attr("y2",8)
    .attr("stroke","var(--accent)").attr("stroke-width",2);
  leg.append("text").attr("x",24).attr("y",12).attr("fill","var(--text2)")
    .attr("font-size","10px").attr("font-family","var(--font-mono)")
    .text("Max CMI (warmest)");
  leg.append("line").attr("x1",0).attr("y1",24).attr("x2",18).attr("y2",24)
    .attr("stroke","var(--hot)").attr("stroke-width",2)
    .attr("stroke-dasharray","5 3");
  leg.append("text").attr("x",24).attr("y",28).attr("fill","var(--text2)")
    .attr("font-size","10px").attr("font-family","var(--font-mono)")
    .text("Min CMI (coldest tops)");
}

// ================================================================
// VIEW 4: Min CMI vs Mean CMI scatter plot
// Each dot = one frame. Reveals whether the coldest pixel
// (deepest cloud top) tracks with the scene mean or diverges.
// Active frame highlighted in orange; others in blue.
// ================================================================
function buildScatter() {
  const M  = { top: 28, right: 24, bottom: 52, left: 62 };
  const TW = Math.min(920, window.innerWidth - 52);
  const TH = 260;
  const W  = TW - M.left - M.right;
  const H  = TH - M.top  - M.bottom;

  const svg = d3.select("#scatter-chart")
    .append("svg").attr("width", TW).attr("height", TH);
  const g = svg.append("g")
    .attr("transform", `translate(${M.left},${M.top})`);

  const xPad = 0.5;
  const yPad = 2;

  const x = d3.scaleLinear()
    .domain([
      d3.min(allFrames, d => d.mean_cmi) - xPad,
      d3.max(allFrames, d => d.mean_cmi) + xPad
    ])
    .range([0, W]);

  const y = d3.scaleLinear()
    .domain([
      d3.min(allFrames, d => d.min_cmi) - yPad,
      d3.max(allFrames, d => d.min_cmi) + yPad
    ])
    .range([H, 0]);

  // Color scale: frame index 0→11 mapped to a sequential blue palette
  const color = d3.scaleSequential()
    .domain([0, allFrames.length - 1])
    .interpolator(d3.interpolateCool);

  // Grid
  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-W).tickFormat(""));
  g.append("g").attr("class", "grid")
    .call(d3.axisBottom(x).ticks(5).tickSize(H).tickFormat(""))
    .attr("transform", `translate(0,0)`);

  // Axes
  g.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d => d.toFixed(2)));

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => d.toFixed(1)));

  // X label
  g.append("text")
    .attr("x", W / 2).attr("y", H + 44)
    .attr("text-anchor", "middle").attr("fill", "var(--text3)")
    .attr("font-size", "10px").attr("font-family", "var(--font-mono)")
    .text("Scene-Mean CMI (K) — average of all CONUS pixels");

  // Y label
  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -H / 2).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--text3)")
    .attr("font-size", "10px").attr("font-family", "var(--font-mono)")
    .text("Min CMI (K) — coldest pixel = highest cloud top");

  // Trend line (linear regression)
  const xMean  = d3.mean(allFrames, d => d.mean_cmi);
  const yMean  = d3.mean(allFrames, d => d.min_cmi);
  const num    = d3.sum(allFrames, d => (d.mean_cmi - xMean) * (d.min_cmi - yMean));
  const den    = d3.sum(allFrames, d => Math.pow(d.mean_cmi - xMean, 2));
  const slope  = den !== 0 ? num / den : 0;
  const interc = yMean - slope * xMean;

  const xExtent = d3.extent(allFrames, d => d.mean_cmi);
  g.append("line")
    .attr("x1", x(xExtent[0])).attr("x2", x(xExtent[1]))
    .attr("y1", y(slope * xExtent[0] + interc))
    .attr("y2", y(slope * xExtent[1] + interc))
    .attr("stroke", "var(--text3)").attr("stroke-width", 1)
    .attr("stroke-dasharray", "4 4").attr("opacity", 0.5);

  g.append("text")
    .attr("x", x(xExtent[1]) - 4)
    .attr("y", y(slope * xExtent[1] + interc) - 6)
    .attr("text-anchor", "end").attr("fill", "var(--text3)")
    .attr("font-size", "9px").attr("font-family", "var(--font-mono)")
    .text("trend");

  // Dots — one per frame, colored by time, clickable
  g.selectAll(".sdot").data(allFrames).join("circle")
    .attr("class", "sdot")
    .attr("cx", d => x(d.mean_cmi))
    .attr("cy", d => y(d.min_cmi))
    .attr("r", 7)
    .attr("fill", d => color(d.index))
    .attr("stroke", "var(--bg2)").attr("stroke-width", 1.5)
    .style("cursor", "pointer")
    .on("mousemove", (event, d) => showTip(
      `${d.timestamp}<br>` +
      `Mean: <b>${d.mean_cmi.toFixed(4)} K</b><br>` +
      `Min: <b>${d.min_cmi.toFixed(2)} K</b><br>` +
      `<span style="font-size:10px;color:#8a99b8">Click to load this frame</span>`,
      event))
    .on("mouseleave", hideTip)
    .on("click", (event, d) => setFrame(d.index));

  // Frame index labels on dots
  g.selectAll(".sdot-label").data(allFrames).join("text")
    .attr("class", "sdot-label")
    .attr("x", d => x(d.mean_cmi))
    .attr("y", d => y(d.min_cmi) + 4)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--bg)")
    .attr("font-size", "8px")
    .attr("font-family", "var(--font-mono)")
    .attr("pointer-events", "none")
    .text(d => d.index);

  // Active frame highlight ring — updated by updateScatter()
  const highlight = g.append("circle")
    .attr("class", "scatter-highlight")
    .attr("r", 11)
    .attr("fill", "none")
    .attr("stroke", "var(--orange)")
    .attr("stroke-width", 2.5)
    .attr("pointer-events", "none");

  // Color legend (time gradient)
  const legendW = 120;
  const legG = g.append("g")
    .attr("transform", `translate(${W - legendW - 4}, 4)`);

  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", "scatter-grad");
  grad.append("stop").attr("offset","0%").attr("stop-color", color(0));
  grad.append("stop").attr("offset","100%").attr("stop-color", color(11));

  legG.append("rect").attr("width", legendW).attr("height", 8)
    .attr("fill", "url(#scatter-grad)").attr("rx", 2);
  legG.append("text").attr("x", 0).attr("y", 20)
    .attr("fill","var(--text3)").attr("font-size","9px")
    .attr("font-family","var(--font-mono)").text("18:01");
  legG.append("text").attr("x", legendW).attr("y", 20)
    .attr("text-anchor","end").attr("fill","var(--text3)")
    .attr("font-size","9px").attr("font-family","var(--font-mono)")
    .text("18:56");
  legG.append("text").attr("x", legendW / 2).attr("y", 32)
    .attr("text-anchor","middle").attr("fill","var(--text3)")
    .attr("font-size","9px").attr("font-family","var(--font-mono)")
    .text("frame time (UTC)");

  function updateScatterFn(idx) {
    const f = allFrames[idx];
    highlight.attr("cx", x(f.mean_cmi)).attr("cy", y(f.min_cmi));
  }
  updateScatterFn(0);
  return updateScatterFn;
}

// ================================================================
// VIEW 1: Frame viewer
// ================================================================
function initViewer() {
  d3.select("#frame-slider")
    .attr("max", allFrames.length - 1)
    .on("input", function() { setFrame(+this.value); });

  d3.select("#speed-slider").on("input", function() {
    playSpeed = +this.value;
    d3.select("#speed-val").text(playSpeed + "ms");
    if (playTimer) { playTimer.stop(); playTimer = startTimer(); }
  });

  d3.select("#btn-prev").on("click", () => setFrame(currentFrame - 1));
  d3.select("#btn-next").on("click", () => setFrame(currentFrame + 1));

  d3.select("#btn-play").on("click", function() {
    if (playTimer) {
      playTimer.stop(); playTimer = null;
      d3.select(this).text("▶ Play").classed("playing", false);
    } else {
      d3.select(this).html("⏸ Pause").classed("playing", true);
      playTimer = startTimer();
    }
  });

  function startTimer() {
    return d3.interval(() => {
      const next = (currentFrame + 1) % allFrames.length;
      setFrame(next);
      if (next === 0) {
        playTimer.stop(); playTimer = null;
        d3.select("#btn-play").text("▶ Play").classed("playing", false);
      }
    }, playSpeed);
  }
}

// ================================================================
// VIEW 5: Details panel
// ================================================================
function updateDetails(frame) {
  const rows = [
    ["Frame",    String(frame.index).padStart(2, "0")],
    ["Time",     frame.timestamp],
    ["Mean CMI", frame.mean_cmi.toFixed(3) + " K"],
    ["Min CMI",  frame.min_cmi.toFixed(2)  + " K"],
    ["Max CMI",  frame.max_cmi.toFixed(2)  + " K"],
    ["Spread",   (frame.max_cmi - frame.min_cmi).toFixed(2) + " K"],
    ["Glob min", frame.globalMin.toFixed(2) + " K"],
    ["Glob max", frame.globalMax.toFixed(2) + " K"],
  ];
  const tbody = d3.select("#details-table tbody");
  tbody.html("");
  rows.forEach(([label, value]) => {
    const tr = tbody.append("tr");
    tr.append("td").text(label);
    tr.append("td").text(value);
  });
}