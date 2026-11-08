// ==========================================
// 1. DATA GENERATION & STATE MANAGEMENT
// ==========================================
let rawData = [];
let timeSeriesChartInstance = null;
let decompositionChartInstance = null;

let currentFilterYear = 'ALL';
let currentGranularity = 'daily'; // 'daily' or 'monthly'
let showTrendline = true;
// Generate realistic Beijing synthetic PM2.5 dataset (2010-01-01 to 2014-12-31)
function generateBeijingData() {
    const data = [];
    const startDate = new Date('2010-01-01');
    const endDate = new Date('2014-12-31');
    let curr = new Date(startDate);
    let index = 0;
    // Seedable pseudo-random
    function pseudoRandom(seed) {
        let x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }
    while (curr <= endDate) {
        const year = curr.getFullYear();
        const month = curr.getMonth(); // 0-11
        const day = curr.getDate();
        const dayOfYear = Math.floor((curr - new Date(year, 0, 0)) / (1000 * 60 * 60 * 24));
        // Baseline macroeconomic gradual decrease (Air Pollution Prevention Action Plan)
        const macroTrend = 110 - (index / 1826) * 22;
        // Strong annual seasonality: High in Winter (heating season: Nov-Feb), Low in Summer (Jul-Aug)
        const seasonalAngle = ((dayOfYear - 15) / 365) * 2 * Math.PI;
        const seasonality = 55 * Math.cos(seasonalAngle); // Peaks around Jan 15
        // Atmospheric noise and occasional heavy smog events
        const noise = (pseudoRandom(index * 13) - 0.45) * 45;
        let hazeSpike = 0;

        // Episodic pollution spikes (15% chance of severe thermal inversion spike)
        if (pseudoRandom(index * 7) > 0.85) {
            hazeSpike = pseudoRandom(index * 3) * 180;
        }
        let pm25 = Math.round(Math.max(12, macroTrend + seasonality + noise + hazeSpike));
        data.push({
            date: new Date(curr),
            dateStr: curr.toISOString().split('T')[0],
            year: year,
            month: month,
            day: day,
            pm25: pm25,
            trend: Math.round(macroTrend),
            seasonal: Math.round(seasonality),
            residual: Math.round(noise + hazeSpike)
        });
        curr.setDate(curr.getDate() + 1);
        index++;
    }
    return data;
}
// Color mapper based on PM2.5 index (WHO / US AQI Standards)
function getAQIColor(val) {
    if (val <= 35) return '#10b981'; // Good (Emerald)
    if (val <= 75) return '#f59e0b'; // Moderate (Amber)
    if (val <= 115) return '#f97316'; // Unhealthy (Orange)
    if (val <= 150) return '#ef4444'; // Hazardous (Red)
    return '#9333ea'; // Severe (Purple)
}
// Calculate moving average for trend smoothing
function computeMovingAverage(data, windowSize) {
    let result = [];
    for (let i = 0; i < data.length; i++) {
        let start = Math.max(0, i - Math.floor(windowSize / 2));
        let end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
        let subset = data.slice(start, end);
        let avg = subset.reduce((sum, d) => sum + d.pm25, 0) / subset.length;
        result.push(avg);
    }
    return result;
}
// ==========================================
// 2. DATA PROCESSING & STATS COMPUTATION
// ==========================================
function getFilteredData() {
    let filtered = rawData;
    if (currentFilterYear !== 'ALL') {
        filtered = filtered.filter(d => d.year === parseInt(currentFilterYear));
    }
    return filtered;
}
function getAggregatedData(data) {
    if (currentGranularity === 'daily') {
        return data.map(d => ({ x: d.dateStr, y: d.pm25, raw: d }));
    } else {
        // Monthly grouping
        const monthlyMap = {};
        data.forEach(d => {
            const key = `${d.year}-${String(d.month + 1).padStart(2, '0')}`;
            if (!monthlyMap[key]) {
                monthlyMap[key] = { sum: 0, count: 0, dateStr: key + '-01' };
            }
            monthlyMap[key].sum += d.pm25;
            monthlyMap[key].count += 1;
        });
        return Object.keys(monthlyMap).sort().map(k => ({
            x: k,
            y: Math.round(monthlyMap[k].sum / monthlyMap[k].count)
        }));
    }
}
function updateOverviewStats(data) {
    if (data.length === 0) return;
    // Overall Mean
    const totalSum = data.reduce((acc, d) => acc + d.pm25, 0);
    const avg = (totalSum / data.length).toFixed(1);
    document.getElementById('stat-avg').innerText = avg;
    // WHO Baseline comparison (WHO annual threshold is 5 µg/m³)
    const whoRatio = (avg / 5).toFixed(1);
    document.getElementById('stat-who-badge').innerText = `${whoRatio}x WHO Target`;
    // Peak Reading
    let peakItem = data[0];
    data.forEach(d => {
        if (d.pm25 > peakItem.pm25) peakItem = d;
    });
    document.getElementById('stat-peak').innerText = peakItem.pm25;
    document.getElementById('stat-peak-date').innerText = `Peak date: ${peakItem.dateStr}`;
    // Cleanest Month computation across whole dataset
    const monthSums = Array(12).fill(0);
    const monthCounts = Array(12).fill(0);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    data.forEach(d => {
        monthSums[d.month] += d.pm25;
        monthCounts[d.month] += 1;
    });
    let minAvg = Infinity;
    let cleanestIdx = 0;
    for (let m = 0; m < 12; m++) {
        if (monthCounts[m] > 0) {
            let mAvg = monthSums[m] / monthCounts[m];
            if (mAvg < minAvg) {
                minAvg = mAvg;
                cleanestIdx = m;
            }
        }
    }
    document.getElementById('stat-cleanest-month').innerText = monthNames[cleanestIdx];
    document.getElementById('stat-cleanest-val').innerText = `Avg: ${minAvg.toFixed(1)} µg/m³`;
    // Total Days
    document.getElementById('stat-total-days').innerText = data.length.toLocaleString();
}
// ==========================================
// 3. CHARTS RENDERING
// ==========================================
function renderTimeSeriesChart() {
    const rawFiltered = getFilteredData();
    const aggData = getAggregatedData(rawFiltered);
    const ctx = document.getElementById('timeSeriesChart').getContext('2d');
    const labels = aggData.map(d => d.x);
    const values = aggData.map(d => d.y);
    // Compute Trendline
    const trendValues = computeMovingAverage(rawFiltered, currentGranularity === 'daily' ? 30 : 5);
    const trendAgg = currentGranularity === 'daily'
        ? trendValues
        : aggData.map((_, idx) => trendValues[Math.min(idx * 30, trendValues.length - 1)]);
    if (timeSeriesChartInstance) {
        timeSeriesChartInstance.destroy();
    }
    timeSeriesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'PM2.5 Concentration',
                    data: values,
                    borderColor: 'rgba(20, 184, 166, 0.85)',
                    backgroundColor: 'rgba(20, 184, 166, 0.1)',
                    borderWidth: currentGranularity === 'daily' ? 1 : 2,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.2
                },
                {
                    label: 'LOESS/MA Trendline',
                    data: showTrendline ? trendAgg : [],
                    borderColor: '#f43f5e',
                    borderWidth: 2.5,
                    borderDash: [],
                    fill: false,
                    pointRadius: 0,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', maxTicksLimit: 12, font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    title: { display: true, text: 'µg/m³', color: '#64748b', font: { size: 10 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10
                }
            }
        }
    });
}
function renderSeasonalMatrix() {
    const matrixContainer = document.getElementById('seasonal-matrix');
    matrixContainer.innerHTML = '';
    const years = [2010, 2011, 2012, 2013, 2014];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Header Row: Blank corner + 5 years
    const headerCorner = document.createElement('div');
    headerCorner.className = 'font-semibold text-slate-500 py-1';
    headerCorner.innerText = 'Month';
    matrixContainer.appendChild(headerCorner);
    years.forEach(yr => {
        const yrHeader = document.createElement('div');
        yrHeader.className = 'font-semibold text-center text-slate-300 py-1 border-b border-slate-800';
        yrHeader.innerText = yr;
        matrixContainer.appendChild(yrHeader);
    });
    // Calculate Monthly Means for Year x Month
    const matrixData = {};
    years.forEach(y => {
        matrixData[y] = Array(12).fill(0).map(() => ({ sum: 0, count: 0 }));
    });
    rawData.forEach(d => {
        if (matrixData[d.year]) {
            matrixData[d.year][d.month].sum += d.pm25;
            matrixData[d.year][d.month].count += 1;
        }
    });
    // Populate rows by Month
    months.forEach((mName, mIdx) => {
        // Month Label
        const mLabel = document.createElement('div');
        mLabel.className = 'font-medium text-slate-400 py-2 flex items-center text-[11px]';
        mLabel.innerText = mName;
        matrixContainer.appendChild(mLabel);
        // Cells for each Year
        years.forEach(yr => {
            const cellObj = matrixData[yr][mIdx];
            const meanVal = cellObj.count > 0 ? Math.round(cellObj.sum / cellObj.count) : 0;
            const cellColor = getAQIColor(meanVal);
            const cell = document.createElement('div');
            cell.className = 'heat-cell rounded p-2 text-center text-[11px] font-bold text-slate-900 cursor-pointer flex items-center justify-center';
            cell.style.backgroundColor = cellColor;
            cell.style.color = meanVal > 120 ? '#ffffff' : '#0f172a';
            cell.innerText = meanVal;
            cell.title = `${mName} ${yr}: Average ${meanVal} µg/m³`;
            matrixContainer.appendChild(cell);
        });
    });
}
function renderDecompositionChart() {
    const rawFiltered = getFilteredData().slice(0, 365); // Display subset for temporal resolution clarity
    const ctx = document.getElementById('decompositionChart').getContext('2d');
    const labels = rawFiltered.map(d => d.dateStr);
    const trendData = rawFiltered.map(d => d.trend);
    const seasonalData = rawFiltered.map(d => d.seasonal);
    const residualData = rawFiltered.map(d => d.residual);
    if (decompositionChartInstance) {
        decompositionChartInstance.destroy();
    }
    decompositionChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Trend',
                    data: trendData,
                    borderColor: '#38bdf8',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: 'Seasonal (Annual)',
                    data: seasonalData,
                    borderColor: '#34d399',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.3
                },
                {
                    label: 'Residual Noise',
                    data: residualData,
                    borderColor: '#f87171',
                    borderWidth: 1,
                    borderDash: [2, 2],
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#64748b', maxTicksLimit: 6, font: { size: 9 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#64748b', font: { size: 9 } }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 }
                },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}
function renderCalendarGrid(selectedYear) {
    const monthHeader = document.getElementById('calendar-month-header');
    const gridContainer = document.getElementById('calendar-grid');
    monthHeader.innerHTML = '';
    gridContainer.innerHTML = '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Header
    months.forEach(m => {
        const div = document.createElement('div');
        div.innerText = m;
        monthHeader.appendChild(div);
    });
    // Group year data by month
    const yearData = rawData.filter(d => d.year === parseInt(selectedYear));
    const monthColumns = Array(12).fill(0).map(() => []);
    yearData.forEach(d => {
        monthColumns[d.month].push(d);
    });
    // Create 12 Month Columns
    monthColumns.forEach((days, mIdx) => {
        const col = document.createElement('div');
        col.className = 'flex flex-col gap-1';
        days.forEach(d => {
            const daySquare = document.createElement('div');
            const color = getAQIColor(d.pm25);

            daySquare.className = 'h-3 rounded-sm transition-transform hover:scale-125 cursor-pointer';
            daySquare.style.backgroundColor = color;
            daySquare.title = `${d.dateStr}: ${d.pm25} µg/m³`;
            col.appendChild(daySquare);
        });
        gridContainer.appendChild(col);
    });
}
// ==========================================
// 4. CONTROLS & EXPORT EVENT HANDLERS
// ==========================================
function setupEventListeners() {
    // Filter Year
    document.getElementById('year-filter').addEventListener('change', (e) => {
        currentFilterYear = e.target.value;
        updateDashboard();
    });
    // Granularity buttons
    const btnDaily = document.getElementById('btn-daily');
    const btnMonthly = document.getElementById('btn-monthly');
    btnDaily.addEventListener('click', () => {
        currentGranularity = 'daily';
        btnDaily.className = "px-3 py-1.5 text-xs font-medium rounded-md text-white bg-teal-600 transition-colors";
        btnMonthly.className = "px-3 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-white transition-colors";
        renderTimeSeriesChart();
    });
    btnMonthly.addEventListener('click', () => {
        currentGranularity = 'monthly';
        btnMonthly.className = "px-3 py-1.5 text-xs font-medium rounded-md text-white bg-teal-600 transition-colors";
        btnDaily.className = "px-3 py-1.5 text-xs font-medium rounded-md text-slate-400 hover:text-white transition-colors";
        renderTimeSeriesChart();
    });
    // Toggle Trendline
    const toggleTrendBtn = document.getElementById('toggle-trend');
    toggleTrendBtn.addEventListener('click', () => {
        showTrendline = !showTrendline;
        toggleTrendBtn.classList.toggle('border-teal-500');
        toggleTrendBtn.classList.toggle('text-teal-400');
        renderTimeSeriesChart();
    });
    // Calendar Year Selection
    document.getElementById('calendar-year-select').addEventListener('change', (e) => {
        renderCalendarGrid(e.target.value);
    });
    // CSV Export Trigger
    document.getElementById('btn-export').addEventListener('click', exportCSV);
}
function exportCSV() {
    const dataToExport = getFilteredData();
    let csvContent = "data:text/csv;charset=utf-8,Date,Year,Month,Day,PM2.5,Trend,Seasonal,Residual\n";
    dataToExport.forEach(d => {
        csvContent += `${d.dateStr},${d.year},${d.month + 1},${d.day},${d.pm25},${d.trend},${d.seasonal},${d.residual}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `beijing_pm25_export_${currentFilterYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
function updateDashboard() {
    const filtered = getFilteredData();
    updateOverviewStats(filtered);
    renderTimeSeriesChart();
    renderDecompositionChart();
}
// ==========================================
// 5. INITIALIZATION
// ==========================================
window.onload = function () {
    rawData = generateBeijingData();
    setupEventListeners();

    // Initial Renders
    updateDashboard();
    renderSeasonalMatrix();
    renderCalendarGrid('2014');
};