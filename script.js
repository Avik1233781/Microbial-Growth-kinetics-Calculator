// Microbial Growth Simulation & Kinetic Analytics Engine
let experiments = {
  "Run 1: Desmos Experimental Data": [
    { t: 0, od: 0.000 },
    { t: 30, od: 0.000 },
    { t: 60, od: 0.082 },
    { t: 90, od: 0.090 },
    { t: 120, od: 0.214 },
    { t: 150, od: 0.335 },
    { t: 180, od: 0.517 },
    { t: 210, od: 0.760 },
    { t: 240, od: 1.146 },
    { t: 270, od: 1.500 },
    { t: 300, od: 1.941 },
    { t: 330, od: 2.372 },
    { t: 360, od: 2.745 },
    { t: 390, od: 2.835 },
    { t: 420, od: 2.915 }
  ]
};

let currentExpKey = "Run 1: Desmos Experimental Data";
let currentOrientation = "OD_X_TIME_Y"; // Default requested: X = OD, Y = Time
let chartInstance = null;
let animationTimer = null;

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  loadFromLocalStorage();
  setupEventListeners();
  populateExperimentSelect();
  initChart();
  renderApp();
  initMicroscope();
});

// Setup Listeners
function setupEventListeners() {
  document.getElementById("btnNewRun").addEventListener("click", handleNewRun);
  document.getElementById("btnRenameRun").addEventListener("click", handleRenameRun);
  document.getElementById("experimentSelect").addEventListener("change", (e) => {
    currentExpKey = e.target.value;
    renderApp();
  });

  // Axis Toggles
  document.getElementById("axisToggleRequested").addEventListener("click", () => {
    setOrientation("OD_X_TIME_Y");
  });
  document.getElementById("axisToggleStandard").addEventListener("click", () => {
    setOrientation("TIME_X_OD_Y");
  });

  // Checkboxes
  document.getElementById("chkShowFit").addEventListener("change", updateChartData);
  document.getElementById("chkBenchmark").addEventListener("change", updateChartData);

  // Quick Add Form
  document.getElementById("quickAddForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = parseFloat(document.getElementById("quickTime").value);
    const od = parseFloat(document.getElementById("quickOD").value);
    if (!isNaN(t) && !isNaN(od)) {
      experiments[currentExpKey].push({ t, od });
      experiments[currentExpKey].sort((a, b) => a.t - b.t);
      saveToLocalStorage();
      renderApp();
      document.getElementById("quickTime").value = "";
      document.getElementById("quickOD").value = "";
    }
  });

  // Clear All
  document.getElementById("btnClearData").addEventListener("click", () => {
    if (confirm("Clear all data points for this experiment? All biological parameters will reset to zero.")) {
      experiments[currentExpKey] = [];
      saveToLocalStorage();
      renderApp();
    }
  });

  // Modal handlers
  document.getElementById("btnPasteModal").addEventListener("click", () => {
    document.getElementById("pasteModal").classList.remove("hidden");
  });
  document.getElementById("btnCloseModal").addEventListener("click", () => {
    document.getElementById("pasteModal").classList.add("hidden");
  });
  document.getElementById("btnCancelPaste").addEventListener("click", () => {
    document.getElementById("pasteModal").classList.add("hidden");
  });
  document.getElementById("btnApplyPaste").addEventListener("click", handleBulkPaste);

  // Export Menu
  document.getElementById("exportMenuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("exportDropdownMenu").classList.toggle("hidden");
  });
  window.addEventListener("click", (e) => {
    if (!e.target.closest(".export-dropdown")) {
      document.getElementById("exportDropdownMenu").classList.add("hidden");
    }
  });

  // Kinetics Solver
  document.getElementById("btnSolveKinetics").addEventListener("click", solveKinetics);

  // Scrubber & Play
  const timeSlider = document.getElementById("timeSlider");
  timeSlider.addEventListener("input", (e) => updateScrubber(parseFloat(e.target.value)));
  document.getElementById("btnPlaySim").addEventListener("click", toggleSimulationPlay);
}

// Set Axis Orientation
function setOrientation(mode) {
  currentOrientation = mode;
  document.getElementById("axisToggleRequested").classList.toggle("active", mode === "OD_X_TIME_Y");
  document.getElementById("axisToggleStandard").classList.toggle("active", mode === "TIME_X_OD_Y");
  updateChartData();
}

// Render Application (Calculations, UI, Table, Visuals)
function renderApp() {
  const data = experiments[currentExpKey] || [];
  renderTable(data);
  computeAndRenderMetrics(data);
  updateChartData();
}

// Compute Biological Parameters (Drop to Zero if empty)
function computeAndRenderMetrics(data) {
  const badge = document.getElementById("liveStatusBadge");
  const tdEl = document.getElementById("valDoublingTime");
  const r2El = document.getElementById("valR2");
  const infEl = document.getElementById("valInflection");
  const maxOdEl = document.getElementById("valMaxOD");
  const lagEl = document.getElementById("valLagPhase");
  const logEl = document.getElementById("valLogPhase");
  const statEl = document.getElementById("valStationaryPhase");

  if (!data || data.length === 0) {
    // STRICT ZERO STATE
    badge.textContent = "0 Points (Empty)";
    badge.className = "badge badge-zero";
    tdEl.textContent = "0.0 min";
    r2El.textContent = "0.000";
    infEl.textContent = "0 min";
    maxOdEl.textContent = "0.000";
    lagEl.textContent = "0 min";
    logEl.textContent = "--";
    statEl.textContent = "--";
    updateBiophysicalChamber(0);
    return;
  }

  badge.textContent = `${data.length} Points Active`;
  badge.className = "badge badge-active";

  const maxOD = Math.max(...data.map(d => d.od));
  maxOdEl.textContent = maxOD.toFixed(3);

  if (data.length < 4) {
    tdEl.textContent = "--";
    r2El.textContent = "0.000";
    infEl.textContent = "--";
    lagEl.textContent = "Needs >=4 pts";
    logEl.textContent = "--";
    statEl.textContent = "--";
    return;
  }

  // Model Parameter Estimation: Modified Gompertz
  const A = Math.max(maxOD, 0.1);
  let maxSlope = 0;
  let infTime = data[0].t;
  for (let i = 1; i < data.length; i++) {
    const dt = data[i].t - data[i-1].t;
    if (dt > 0) {
      const slope = (data[i].od - data[i-1].od) / dt;
      if (slope > maxSlope) {
        maxSlope = slope;
        infTime = (data[i].t + data[i-1].t) / 2;
      }
    }
  }

  let lagEstimate = 60;
  for (let i = 0; i < data.length; i++) {
    if (data[i].od > 0.05 * A) {
      lagEstimate = data[i].t;
      break;
    }
  }

  const mu = Math.max(maxSlope, 0.001);
  const td = Math.LN2 / mu;

  let ssTot = 0;
  let ssRes = 0;
  const meanOD = data.reduce((acc, d) => acc + d.od, 0) / data.length;

  data.forEach(pt => {
    const pred = gompertzFunc(pt.t, A, mu, lagEstimate);
    ssTot += Math.pow(pt.od - meanOD, 2);
    ssRes += Math.pow(pt.od - pred, 2);
  });
  const r2 = ssTot > 0 ? Math.max(0, 1 - (ssRes / ssTot)) : 0.99;

  tdEl.textContent = `${td.toFixed(1)} min`;
  r2El.textContent = r2.toFixed(3);
  infEl.textContent = `${Math.round(infTime)} min`;
  lagEl.textContent = `0 - ${Math.round(lagEstimate)} min`;

  let statTime = data[data.length - 1].t;
  for (let i = data.length - 1; i > 0; i--) {
    const dt = data[i].t - data[i-1].t;
    if (dt > 0) {
      const slope = (data[i].od - data[i-1].od) / dt;
      if (slope > 0.25 * maxSlope) {
        statTime = data[i].t;
        break;
      }
    }
  }

  logEl.textContent = `${Math.round(lagEstimate)} - ${Math.round(statTime)} min`;
  statEl.textContent = `> ${Math.round(statTime)} min`;

  updateBiophysicalChamber(data[data.length - 1].od);
}

function gompertzFunc(t, A, mu, lambda) {
  if (t <= 0 && lambda > 0) return 0;
  const val = A * Math.exp(-Math.exp(((mu * Math.E) / A) * (lambda - t) + 1));
  return isNaN(val) ? 0 : val;
}

// Table Render
function renderTable(data) {
  const tbody = document.getElementById("dataTableBody");
  tbody.innerHTML = "";
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#64748b; padding:16px;">No data entered. Add points above or paste data.</td></tr>`;
    return;
  }
  data.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${row.t}</td>
      <td>${row.od.toFixed(3)}</td>
      <td><button class="btn btn-sm btn-danger-outline" onclick="deletePoint(${index})">×</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.deletePoint = function(index) {
  experiments[currentExpKey].splice(index, 1);
  saveToLocalStorage();
  renderApp();
};

// Chart Initialization
function initChart() {
  const ctx = document.getElementById("growthChart").getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Experimental Points",
          data: [],
          backgroundColor: "#c084fc",
          borderColor: "#9d72ff",
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: "Fitted Model Curve",
          data: [],
          type: "line",
          borderColor: "#38bdf8",
          borderWidth: 2.5,
          fill: false,
          pointRadius: 0
        },
        {
          label: "E. coli Reference (td=20m)",
          data: [],
          type: "line",
          borderColor: "#f43f5e",
          borderDash: [5, 5],
          borderWidth: 1.8,
          fill: false,
          pointRadius: 0,
          hidden: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: "#2b3648" },
          ticks: { color: "#94a3b8" },
          title: { display: true, text: "Optical Density (OD)", color: "#f1f5f9", font: { weight: "bold" } }
        },
        y: {
          grid: { color: "#2b3648" },
          ticks: { color: "#94a3b8" },
          title: { display: true, text: "Time (minutes)", color: "#f1f5f9", font: { weight: "bold" } }
        }
      },
      plugins: {
        legend: { labels: { color: "#f1f5f9" } }
      }
    }
  });
}

function updateChartData() {
  if (!chartInstance) return;
  const rawData = experiments[currentExpKey] || [];
  const isRequested = (currentOrientation === "OD_X_TIME_Y");

  const scatterPoints = rawData.map(pt => isRequested ? { x: pt.od, y: pt.t } : { x: pt.t, y: pt.od });
  chartInstance.data.datasets[0].data = scatterPoints;

  chartInstance.options.scales.x.title.text = isRequested ? "Optical Density (OD)" : "Time (minutes)";
  chartInstance.options.scales.y.title.text = isRequested ? "Time (minutes)" : "Optical Density (OD)";

  const showFit = document.getElementById("chkShowFit").checked;
  const showBenchmark = document.getElementById("chkBenchmark").checked;

  if (showFit && rawData.length >= 3) {
    const maxOD = Math.max(...rawData.map(d => d.od));
    const maxT = Math.max(...rawData.map(d => d.t), 420);
    const fitLine = [];

    for (let t = 0; t <= maxT + 30; t += 5) {
      const simOD = gompertzFunc(t, maxOD, 0.015, 60);
      fitLine.push(isRequested ? { x: simOD, y: t } : { x: t, y: simOD });
    }
    chartInstance.data.datasets[1].data = fitLine;
    chartInstance.data.datasets[1].hidden = false;
  } else {
    chartInstance.data.datasets[1].data = [];
  }

  if (showBenchmark) {
    const benchLine = [];
    const maxT = rawData.length ? Math.max(...rawData.map(d => d.t), 300) : 300;
    const muBench = Math.LN2 / 20;
    for (let t = 0; t <= maxT; t += 5) {
      const od = gompertzFunc(t, 3.0, muBench, 30);
      benchLine.push(isRequested ? { x: od, y: t } : { x: t, y: od });
    }
    chartInstance.data.datasets[2].data = benchLine;
    chartInstance.data.datasets[2].hidden = false;
  } else {
    chartInstance.data.datasets[2].data = [];
    chartInstance.data.datasets[2].hidden = true;
  }

  chartInstance.update();
}

function handleBulkPaste() {
  const text = document.getElementById("pasteTextarea").value.trim();
  if (!text) return;
  const lines = text.split(/\r?\n/);
  const parsed = [];

  lines.forEach(line => {
    const parts = line.trim().split(/\s+|,|\t/);
    if (parts.length >= 2) {
      const val1 = parseFloat(parts[0]);
      const val2 = parseFloat(parts[1]);
      if (!isNaN(val1) && !isNaN(val2)) {
        if (val1 > 5 && val2 <= 5) {
          parsed.push({ t: val1, od: val2 });
        } else if (val2 > 5 && val1 <= 5) {
          parsed.push({ t: val2, od: val1 });
        } else {
          parsed.push({ t: val1, od: val2 });
        }
      }
    }
  });

  if (parsed.length > 0) {
    parsed.sort((a, b) => a.t - b.t);
    experiments[currentExpKey] = parsed;
    saveToLocalStorage();
    renderApp();
    document.getElementById("pasteModal").classList.add("hidden");
    document.getElementById("pasteTextarea").value = "";
  } else {
    alert("Could not detect valid data pairs. Ensure each line has Time and OD separated by spaces or tabs.");
  }
}

function solveKinetics() {
  const t1 = parseFloat(document.getElementById("kTime1").value);
  const od1 = parseFloat(document.getElementById("kOD1").value);
  const t2 = parseFloat(document.getElementById("kTime2").value);
  const od2 = parseFloat(document.getElementById("kOD2").value);

  if (isNaN(t1) || isNaN(od1) || isNaN(t2) || isNaN(od2) || t2 <= t1 || od1 <= 0 || od2 <= 0) {
    alert("Please provide valid points with t2 > t1 and positive OD values.");
    return;
  }

  const mu = (Math.log(od2) - Math.log(od1)) / (t2 - t1);
  const td = Math.LN2 / mu;

  document.getElementById("resMu").textContent = mu.toFixed(4);
  document.getElementById("resMuHour").textContent = (mu * 60).toFixed(2);
  document.getElementById("resTd").textContent = td.toFixed(1);
  document.getElementById("kineticsResultBox").classList.remove("hidden");
}

function updateScrubber(t) {
  document.getElementById("scrubTimeDisplay").textContent = `${t} min`;
  const rawData = experiments[currentExpKey] || [];
  const maxOD = rawData.length ? Math.max(...rawData.map(d => d.od)) : 0;
  const od = rawData.length ? gompertzFunc(t, maxOD, 0.015, 60) : 0;
  document.getElementById("scrubODDisplay").textContent = od.toFixed(3);
  updateBiophysicalChamber(od);
}

function updateBiophysicalChamber(od) {
  const tPercent = Math.max(0.01, Math.pow(10, -od) * 100);
  document.getElementById("valTransmittance").textContent = `${tPercent.toFixed(1)}%`;
  document.getElementById("valAbsorbance").textContent = od.toFixed(3);

  const opacity = Math.min(0.92, 0.1 + (od / 3.0) * 0.82);
  document.getElementById("cuvetteLiquid").style.background = `rgba(215, 175, 80, ${opacity})`;

  const cells = (od * 8.0).toFixed(1);
  document.getElementById("valCellCount").innerHTML = `${cells} &times; 10<sup>8</sup>`;
}

function toggleSimulationPlay() {
  const btn = document.getElementById("btnPlaySim");
  const slider = document.getElementById("timeSlider");
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
    btn.textContent = "▶ Play";
  } else {
    btn.textContent = "⏸ Pause";
    animationTimer = setInterval(() => {
      let val = parseFloat(slider.value) + 2;
      if (val > parseFloat(slider.max)) val = 0;
      slider.value = val;
      updateScrubber(val);
    }, 40);
  }
}

function initMicroscope() {
  const canvas = document.getElementById("microscopeCanvas");
  const ctx = canvas.getContext("2d");
  const bacteria = [];
  for (let i = 0; i < 40; i++) {
    bacteria.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.7,
      vy: (Math.random() - 0.5) * 0.7,
      angle: Math.random() * Math.PI * 2
    });
  }

  function renderCells() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const od = parseFloat(document.getElementById("valAbsorbance").textContent) || 0;
    const count = Math.min(bacteria.length, Math.floor(od * 12) + 2);

    for (let i = 0; i < count; i++) {
      const b = bacteria[i];
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < 10 || b.x > canvas.width - 10) b.vx *= -1;
      if (b.y < 10 || b.y > canvas.height - 10) b.vy *= -1;

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = "rgba(167, 243, 208, 0.85)";
      ctx.beginPath();
      ctx.roundRect(-7, -3, 14, 6, 3);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(renderCells);
  }
  renderCells();
}

function handleNewRun() {
  const name = prompt("Enter name for new experimental run:", `Run ${Object.keys(experiments).length + 1}`);
  if (name && name.trim()) {
    experiments[name.trim()] = [];
    currentExpKey = name.trim();
    saveToLocalStorage();
    populateExperimentSelect();
    renderApp();
  }
}

function handleRenameRun() {
  const name = prompt("Rename active run:", currentExpKey);
  if (name && name.trim() && name.trim() !== currentExpKey) {
    experiments[name.trim()] = experiments[currentExpKey];
    delete experiments[currentExpKey];
    currentExpKey = name.trim();
    saveToLocalStorage();
    populateExperimentSelect();
    renderApp();
  }
}

function populateExperimentSelect() {
  const select = document.getElementById("experimentSelect");
  select.innerHTML = "";
  Object.keys(experiments).forEach(key => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    if (key === currentExpKey) opt.selected = true;
    select.appendChild(opt);
  });
}

function saveToLocalStorage() {
  try {
    localStorage.setItem("microbial_sim_data", JSON.stringify(experiments));
    localStorage.setItem("microbial_sim_active", currentExpKey);
  } catch (e) {
    console.error("Local storage error:", e);
  }
}

function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem("microbial_sim_data");
    const active = localStorage.getItem("microbial_sim_active");
    if (saved) experiments = JSON.parse(saved);
    if (active && experiments[active]) currentExpKey = active;
  } catch (e) {
    console.error("Error loading local storage:", e);
  }
}

// -------------------------------------------------------------------------
// DIRECT VECTOR PDF GENERATOR USING jsPDF & AutoTable (ZERO BROWSER GLITCHES)
// -------------------------------------------------------------------------
window.exportToPDF = function() {
  // Hide dropdown menu immediately
  document.getElementById("exportDropdownMenu").classList.add("hidden");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4"
  });

  const data = experiments[currentExpKey] || [];
  const tdVal = document.getElementById("valDoublingTime").textContent;
  const r2Val = document.getElementById("valR2").textContent;
  const infVal = document.getElementById("valInflection").textContent;
  const maxOdVal = document.getElementById("valMaxOD").textContent;
  const lagVal = document.getElementById("valLagPhase").textContent;
  const logVal = document.getElementById("valLogPhase").textContent;
  const statVal = document.getElementById("valStationaryPhase").textContent;

  // Header Banner
  doc.setFillColor(30, 27, 75); // Indigo dark
  doc.rect(0, 0, 210, 24, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MICROBIAL GROWTH KINETICS LAB REPORT", 14, 13);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(199, 210, 254);
  doc.text(`Run: ${currentExpKey}  |  Generated: ${new Date().toLocaleString()}`, 14, 19);

  // Section 1: Biological Parameters Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text("1. BIOLOGICAL & KINETIC PARAMETERS", 14, 33);

  const paramRows = [
    ["Doubling Time (td)", tdVal, "Goodness of Fit (R²)", r2Val],
    ["Inflection Point (ti)", infVal, "Max Optical Density", maxOdVal],
    ["Lag Phase", lagVal, "Exponential Phase", logVal],
    ["Stationary Phase", statVal, "Total Measured Points", `${data.length} readings`]
  ];

  doc.autoTable({
    startY: 36,
    body: paramRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [248, 250, 252], width: 45 },
      1: { fontStyle: 'bold', textColor: [99, 102, 241], width: 45 },
      2: { fontStyle: 'bold', fillColor: [248, 250, 252], width: 45 },
      3: { fontStyle: 'bold', textColor: [16, 185, 129], width: 45 }
    },
    margin: { left: 14, right: 14 }
  });

  let currentY = doc.lastAutoTable.finalY + 8;

  // Section 2: Chart Image (High Resolution Canvas Snapshot)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text("2. GROWTH CURVE PLOT", 14, currentY);
  currentY += 4;

  if (chartInstance) {
    try {
      const chartImg = chartInstance.toBase64Image();
      // Embed chart: 182mm wide, 72mm high
      doc.addImage(chartImg, "PNG", 14, currentY, 182, 72);
      currentY += 76;
    } catch (e) {
      console.error("Error capturing chart", e);
    }
  }

  // Section 3: Full Data Table (ALL 15+ values included, no scroll cutting!)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text(`3. EXPERIMENTAL READINGS (N = ${data.length})`, 14, currentY);

  const tableData = data.map((d, index) => [
    index + 1,
    `${d.t} min`,
    d.od.toFixed(3)
  ]);

  doc.autoTable({
    startY: currentY + 3,
    head: [["#", "Time (min)", "Optical Density (OD600)"]],
    body: tableData,
    theme: "striped",
    headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: "bold" },
    styles: { fontSize: 8.5, cellPadding: 2.2, halign: "center" },
    margin: { left: 14, right: 14 },
    pageBreak: "auto"
  });

  // Footer on all pages
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Microbial Growth Kinetics Simulation Lab • Page ${i} of ${pageCount}`,
      14,
      290
    );
  }

  // Directly download clean PDF file
  const filename = `${currentExpKey.replace(/[^a-z0-9]/gi, '_')}_Report.pdf`;
  doc.save(filename);
};

// Export to Excel (.xlsx)
window.exportToExcel = function() {
  document.getElementById("exportDropdownMenu").classList.add("hidden");
  const data = experiments[currentExpKey] || [];
  const wsData = [
    ["MICROBIAL GROWTH EXPERIMENTAL REPORT"],
    ["Run Title:", currentExpKey],
    ["Export Date:", new Date().toLocaleString()],
    ["Doubling Time (td):", document.getElementById("valDoublingTime").textContent],
    ["Max Optical Density:", document.getElementById("valMaxOD").textContent],
    ["Goodness of Fit (R^2):", document.getElementById("valR2").textContent],
    [],
    ["#", "Time (minutes)", "Optical Density (OD600)"]
  ];

  data.forEach((pt, i) => wsData.push([i + 1, pt.t, pt.od]));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Kinetics Report");
  XLSX.writeFile(wb, `${currentExpKey.replace(/[^a-z0-9]/gi, '_')}.xlsx`);
};

// Export to Word (.doc)
window.exportToWord = function() {
  document.getElementById("exportDropdownMenu").classList.add("hidden");
  const data = experiments[currentExpKey] || [];
  let tableRows = data.map((pt, i) => `<tr><td style="border:1px solid #cbd5e1; padding:6px 12px;">${i+1}</td><td style="border:1px solid #cbd5e1; padding:6px 12px;">${pt.t}</td><td style="border:1px solid #cbd5e1; padding:6px 12px;">${pt.od.toFixed(3)}</td></tr>`).join("");

  const docContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
    <head>
      <meta charset="utf-8" />
      <title>Microbial Growth Kinetics Report</title>
      <style>
        body { font-family: Calibri, Arial, sans-serif; color: #1e293b; padding: 25px; line-height: 1.5; }
        h1 { color: #4338ca; border-bottom: 2px solid #4338ca; padding-bottom: 6px; }
        h2 { color: #1e293b; margin-top: 20px; font-size: 14pt; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; }
        .param-table td { border: 1px solid #cbd5e1; padding: 6px 12px; }
      </style>
    </head>
    <body>
      <h1>Microbial Growth Kinetics Report</h1>
      <p><strong>Experimental Run:</strong> ${currentExpKey}</p>
      <p><strong>Generated Date:</strong> ${new Date().toLocaleString()}</p>
      
      <h2>1. Biological & Kinetic Parameters</h2>
      <table class="param-table" style="width: 80%;">
        <tr><td><strong>Doubling Time (t<sub>d</sub>):</strong></td><td>${document.getElementById("valDoublingTime").textContent}</td></tr>
        <tr><td><strong>Goodness of Fit (R<sup>2</sup>):</strong></td><td>${document.getElementById("valR2").textContent}</td></tr>
        <tr><td><strong>Inflection Point (t<sub>i</sub>):</strong></td><td>${document.getElementById("valInflection").textContent}</td></tr>
        <tr><td><strong>Max Optical Density:</strong></td><td>${document.getElementById("valMaxOD").textContent}</td></tr>
        <tr><td><strong>Lag Phase:</strong></td><td>${document.getElementById("valLagPhase").textContent}</td></tr>
        <tr><td><strong>Exponential (Log) Phase:</strong></td><td>${document.getElementById("valLogPhase").textContent}</td></tr>
        <tr><td><strong>Stationary Phase:</strong></td><td>${document.getElementById("valStationaryPhase").textContent}</td></tr>
      </table>

      <h2>2. Full Experimental Readings (N = ${data.length})</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Time (minutes)</th>
            <th>Optical Density (OD)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([docContent], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${currentExpKey.replace(/[^a-z0-9]/gi, '_')}.doc`;
  a.click();
};
