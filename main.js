/* ================================================================
   main.js – DSC 106 Project 3 Checkpoint
   GOES-19 Channel 13 satellite frame explorer

   What this file does:
     1. Loads frames.json and cloud_summary.csv with D3
     2. View 1–3: Frame viewer + slider + play/pause
     3. View 4:   Mean CMI line chart with moving marker
     4. View 5:   Min/max CMI range chart
     5. View 6:   Metadata details panel for selected frame

   Image paths come from frames.json and look like:
     "data/frames/frame_00.png"
   This works on GitHub Pages when index.html is at the repo root.
   ================================================================ */


// ── Step 1: Load both data files before doing anything ────────────
// d3.json loads frames.json; d3.csv loads cloud_summary.csv
// d3.autoType converts numeric strings to numbers automatically
Promise.all([
  d3.json("data/frames/frames.json"),
  d3.csv("data/frames/cloud_summary.csv", d3.autoType)

]).then(function(results) {

  const frames  = results[0];  // array of 12 frame objects
  const summary = results[1];  // array of 12 rows with mean/min/max CMI

  // Merge summary stats into the frames array by index
  // so each frame object carries its own mean_cmi, min_cmi, max_cmi
  const statsMap = new Map(summary.map(s => [s.index, s]));
  frames.forEach(function(f) {
    const s = statsMap.get(f.index) || {};
    f.mean_cmi = s.mean_cmi;
    f.min_cmi  = s.min_cmi;
    f.max_cmi  = s.max_cmi;
  });

  // ── Shared tooltip ──────────────────────────────────────────────
  const tooltip = d3.select("#tooltip");

  function showTooltip(html, event) {
    tooltip.html(html)
      .classed("visible", true)
      .style("left", (event.clientX + 14) + "px")
      .style("top",  (event.clientY - 10) + "px");
  }

  function hideTooltip() {
    tooltip.classed("visible", false);
  }


  // ================================================================
  // VIEWS 1–3: Frame viewer, slider, play/pause
  // ================================================================

  let currentFrame = 0;  // tracks which frame is displayed
  let playTimer    = null;  // holds the d3.interval when playing

  // Set the slider endpoint labels via the time labels in frames.json
  // (We rely on the slider's min=0 max=11 set in the HTML)

  // Build the mean chart now (needed so we can call updateMarker later)
  // We call this before setFrame so the marker function exists
  const updateMarker = buildMeanChart(frames, showTooltip, hideTooltip);

  // Build range chart (no marker needed, it's static)
  buildRangeChart(frames, showTooltip, hideTooltip);

  // setFrame: the single function that keeps everything in sync
  // Call this any time the user changes the active frame
  function setFrame(idx) {
    // Clamp index to valid range
    currentFrame = Math.max(0, Math.min(frames.length - 1, idx));

    const f = frames[currentFrame];

    // Update the satellite image (View 1)
    d3.select("#main-frame").attr("src", f.image);

    // Update the timestamp label above the image
    d3.select("#frame-label")
      .text("Frame " + String(currentFrame).padStart(2, "0")
            + " — " + f.timestamp);

    // Update the slider position and counter text (View 2)
    d3.select("#frame-slider").property("value", currentFrame);
    d3.select("#slider-val").text(currentFrame + " / " + (frames.length - 1));

    // Update the moving marker on the mean chart (View 4)
    updateMarker(currentFrame);

    // Update the details panel (View 6)
    updateDetails(f);
  }

  // Slider input: fires every time the user drags it
  d3.select("#frame-slider").on("input", function() {
    setFrame(+this.value);  // convert string to number with +
  });

  // Prev / Next buttons
  d3.select("#btn-prev").on("click", function() {
    setFrame(currentFrame - 1);
  });

  d3.select("#btn-next").on("click", function() {
    setFrame(currentFrame + 1);
  });

  // Play / Pause button (View 3)
  d3.select("#btn-play").on("click", function() {
    if (playTimer) {
      // Currently playing → stop
      playTimer.stop();
      playTimer = null;
      d3.select(this).text("▶ Play").classed("playing", false);
    } else {
      // Currently paused → start
      d3.select(this).text("⏸ Pause").classed("playing", true);

      // d3.interval calls this function every 700 ms
      playTimer = d3.interval(function() {
        const next = (currentFrame + 1) % frames.length;
        setFrame(next);
        // Stop automatically after one full loop
        if (next === 0) {
          playTimer.stop();
          playTimer = null;
          d3.select("#btn-play").text("▶ Play").classed("playing", false);
        }
      }, 700);
    }
  });

  // Initialize everything on frame 0
  setFrame(0);

});  // end Promise.all


// ================================================================
// VIEW 4: Mean CMI over time — line chart with moving marker
// Returns an updateMarker(frameIndex) function
// ================================================================
function buildMeanChart(frames, showTooltip, hideTooltip) {

  // Chart dimensions and margins
  const margin = { top: 20, right: 20, bottom: 50, left: 65 };
  const totalWidth  = Math.min(860, window.innerWidth - 60);
  const totalHeight = 250;
  const width  = totalWidth  - margin.left - margin.right;
  const height = totalHeight - margin.top  - margin.bottom;

  // Create the SVG inside #mean-chart
  const svg = d3.select("#mean-chart")
    .append("svg")
    .attr("width",  totalWidth)
    .attr("height", totalHeight);

  // "g" is the drawing group, shifted in by the margins
  const g = svg.append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  // ── Scales ──────────────────────────────────────────────────────
  // X: frame index 0–11
  const x = d3.scaleLinear()
    .domain([0, frames.length - 1])
    .range([0, width]);

  // Y: zoom in on the actual data range so the trend is visible
  // The real range is ~279.37–279.41 K, so we add a small padding
  const yPad = 0.025;
  const y = d3.scaleLinear()
    .domain([
      d3.min(frames, d => d.mean_cmi) - yPad,
      d3.max(frames, d => d.mean_cmi) + yPad
    ])
    .range([height, 0]);

  // ── Grid lines (faint horizontal) ───────────────────────────────
  g.append("g")
    .attr("class", "grid")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickSize(-width)
        .tickFormat("")  // no labels on the grid lines themselves
    );

  // ── Axes ────────────────────────────────────────────────────────
  // X axis: show the time label (e.g. "18:01") for each frame
  g.append("g")
    .attr("class", "axis")
    .attr("transform", "translate(0," + height + ")")
    .call(
      d3.axisBottom(x)
        .tickValues(d3.range(0, frames.length))
        // Strip date portion, keep "HH:MM"
        .tickFormat(i => frames[i]
          ? frames[i].timestamp.replace("2026-05-05 ", "").replace(" UTC", "")
          : "")
    )
    .selectAll("text")
      .attr("transform", "rotate(-40)")
      .style("text-anchor", "end")
      .attr("dx", "-0.4em")
      .attr("dy", "0.1em");

  // Y axis
  g.append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => d.toFixed(2)));

  // Y axis label
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -52)
    .attr("text-anchor", "middle")
    .attr("fill", "#555")
    .attr("font-size", "11px")
    .text("Mean CMI (K)");

  // ── Line ────────────────────────────────────────────────────────
  const lineGen = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.mean_cmi))
    .curve(d3.curveMonotoneX);  // smooth curve

  g.append("path")
    .datum(frames)
    .attr("class", "line-mean")
    .attr("d", lineGen);

  // ── Dots with hover tooltip ──────────────────────────────────────
  g.selectAll(".dot")
    .data(frames)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", (d, i) => x(i))
    .attr("cy", d => y(d.mean_cmi))
    .attr("r", 5)
    .on("mousemove", function(event, d) {
      showTooltip(
        d.timestamp + "<br>Mean CMI: <b>" + d.mean_cmi.toFixed(4) + " K</b>",
        event
      );
    })
    .on("mouseleave", hideTooltip);

  // ── Moving marker (vertical line + orange dot) ───────────────────
  // This gets repositioned by updateMarker() whenever the frame changes
  const markerLine = g.append("line")
    .attr("class", "marker-line")
    .attr("y1", 0)
    .attr("y2", height);

  const markerDot = g.append("circle")
    .attr("class", "marker-dot")
    .attr("r", 7);

  // Return the update function so setFrame() can call it
  function updateMarker(frameIdx) {
    const xPos = x(frameIdx);
    const yPos = y(frames[frameIdx].mean_cmi);
    markerLine.attr("x1", xPos).attr("x2", xPos);
    markerDot.attr("cx", xPos).attr("cy", yPos);
  }

  updateMarker(0);  // initialize at frame 0
  return updateMarker;
}


// ================================================================
// VIEW 5: Min / Max CMI range chart
// Shaded band + two lines (max = blue, min = red dashed)
// ================================================================
function buildRangeChart(frames, showTooltip, hideTooltip) {

  const margin = { top: 20, right: 20, bottom: 50, left: 65 };
  const totalWidth  = Math.min(860, window.innerWidth - 60);
  const totalHeight = 260;
  const width  = totalWidth  - margin.left - margin.right;
  const height = totalHeight - margin.top  - margin.bottom;

  const svg = d3.select("#range-chart")
    .append("svg")
    .attr("width",  totalWidth)
    .attr("height", totalHeight);

  const g = svg.append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  // ── Scales ──────────────────────────────────────────────────────
  const x = d3.scaleLinear()
    .domain([0, frames.length - 1])
    .range([0, width]);

  const y = d3.scaleLinear()
    .domain([
      d3.min(frames, d => d.min_cmi) - 2,
      d3.max(frames, d => d.max_cmi) + 2
    ])
    .range([height, 0]);

  // ── Grid ────────────────────────────────────────────────────────
  g.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-width).tickFormat(""));

  // ── Axes ────────────────────────────────────────────────────────
  g.append("g")
    .attr("class", "axis")
    .attr("transform", "translate(0," + height + ")")
    .call(
      d3.axisBottom(x)
        .tickValues(d3.range(0, frames.length))
        .tickFormat(i => frames[i]
          ? frames[i].timestamp.replace("2026-05-05 ", "").replace(" UTC", "")
          : "")
    )
    .selectAll("text")
      .attr("transform", "rotate(-40)")
      .style("text-anchor", "end")
      .attr("dx", "-0.4em")
      .attr("dy", "0.1em");

  g.append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(6));

  // Y axis label
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -52)
    .attr("text-anchor", "middle")
    .attr("fill", "#555")
    .attr("font-size", "11px")
    .text("CMI (K)");

  // ── Shaded band between min and max ─────────────────────────────
  const areaGen = d3.area()
    .x((d, i) => x(i))
    .y0(d => y(d.min_cmi))
    .y1(d => y(d.max_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "area-range")
    .attr("d", areaGen);

  // ── Max line (blue) ──────────────────────────────────────────────
  const lineMax = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.max_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "line-max")
    .attr("d", lineMax);

  // ── Min line (red dashed) ────────────────────────────────────────
  const lineMin = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.min_cmi))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(frames)
    .attr("class", "line-min")
    .attr("d", lineMin);

  // ── Invisible hover targets on max line for tooltip ──────────────
  g.selectAll(".dot-range")
    .data(frames)
    .join("circle")
    .attr("class", "dot")   // reuse dot style
    .attr("cx", (d, i) => x(i))
    .attr("cy", d => y(d.max_cmi))
    .attr("r", 4)
    .on("mousemove", function(event, d) {
      showTooltip(
        d.timestamp
        + "<br>Max: <b>" + d.max_cmi.toFixed(2) + " K</b>"
        + "<br>Min: <b>" + d.min_cmi.toFixed(2) + " K</b>"
        + "<br>Range: <b>" + (d.max_cmi - d.min_cmi).toFixed(2) + " K</b>",
        event
      );
    })
    .on("mouseleave", hideTooltip);

  // ── Simple legend ────────────────────────────────────────────────
  const legend = g.append("g")
    .attr("transform", "translate(" + (width - 170) + ", 6)");

  // Max legend item
  legend.append("line")
    .attr("x1", 0).attr("y1", 8).attr("x2", 20).attr("y2", 8)
    .attr("stroke", "#1a7abf").attr("stroke-width", 2);
  legend.append("text")
    .attr("x", 25).attr("y", 12)
    .attr("fill", "#444").attr("font-size", "11px")
    .text("Max CMI (warmest)");

  // Min legend item
  legend.append("line")
    .attr("x1", 0).attr("y1", 24).attr("x2", 20).attr("y2", 24)
    .attr("stroke", "#c0392b").attr("stroke-width", 2)
    .attr("stroke-dasharray", "5 3");
  legend.append("text")
    .attr("x", 25).attr("y", 28)
    .attr("fill", "#444").attr("font-size", "11px")
    .text("Min CMI (coldest)");
}


// ================================================================
// VIEW 6: Details panel — updates on every frame change
// ================================================================
function updateDetails(frame) {

  // Rows to display: [ label, value ]
  const rows = [
    ["Frame index",  String(frame.index).padStart(2, "0")],
    ["Timestamp",    frame.timestamp],
    ["Mean CMI",     frame.mean_cmi.toFixed(3) + " K"],
    ["Min CMI",      frame.min_cmi.toFixed(2)  + " K"],
    ["Max CMI",      frame.max_cmi.toFixed(2)  + " K"],
    ["CMI range",    (frame.max_cmi - frame.min_cmi).toFixed(2) + " K"],
    ["Global min",   frame.globalMin.toFixed(2) + " K"],
    ["Global max",   frame.globalMax.toFixed(2) + " K"],
    ["Source file",  frame.source]
  ];

  // Clear the table, then rebuild with current frame's data
  const tbody = d3.select("#details-table tbody");
  tbody.html("");

  rows.forEach(function([label, value]) {
    const tr = tbody.append("tr");
    tr.append("td").text(label);
    tr.append("td").text(value);
  });
}
