// ====================================================================================
// GLOBAL CONFIGURATION
// ====================================================================================

const CONFIG = {
    // New GitHub repository configuration
    REPO_OWNER: 'safecoastpro',
    REPO_NAME: 'safecoastpro.github.io',
    RELEASE_TAG: 'twl_update_latest',
    // Base URL for API calls
    GITHUB_API_BASE: 'https://api.github.com/repos/',

    // Sites file
    DATA_BASE_PATH: './', 
    SITES_FILENAME: 'sites_file.json'
};

const RISK_COLORS = {
    "No Flood": "#28a745",    // Green
    "Warning": "#ffc107",    // Yellow
    "High Risk": "#fd7e14",   // Orange
    "Severe Flood": "#dc3545", // Red
    "N/A": "#6c757d"
};

const VIGILANCE_LEVELS = [
    { level: "No Flood", color: RISK_COLORS["No Flood"], description: "Minimal coastal risk." },
    { level: "Warning", color: RISK_COLORS["Warning"], description: "Minor flooding possible." },
    { level: "High Risk", color: RISK_COLORS["High Risk"], description: "Significant coastal flooding expected." },
    { level: "Severe Flood", color: RISK_COLORS["Severe Flood"], description: "Extreme and destructive flooding." }
];

// ====================================================================================
// GITHUB DATA FETCHING UTILITIES
// ====================================================================================

let RELEASE_INFO = null; // Cache for the release data

/**
 * Fetches the metadata for the specific GitHub release tag.
 * @returns {Object} The release data object from GitHub.
 */
async function getReleaseInfo() {
    if (RELEASE_INFO) {
        return RELEASE_INFO;
    }

    const url = `${CONFIG.GITHUB_API_BASE}${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/releases/tags/${CONFIG.RELEASE_TAG}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }
        RELEASE_INFO = await response.json();
        return RELEASE_INFO;
    } catch (e) {
        console.error("Failed to fetch GitHub release metadata:", e);
        // Important: Use the data directory as fallback if the API fails, 
        // assuming files might still be present locally in development.
        return null; 
    }
}

/**
 * Constructs the raw download URL for a given asset filename.
 * @param {string} filename - The name of the file to download (e.g., 'all_twl_data_GHANA_20251206.csv').
 * @returns {string|null} The direct download URL, or null if the release/asset is not found.
 */
async function getAssetDownloadUrl(filename) {
    const info = await getReleaseInfo();
    if (!info || !info.assets) {
        console.warn(`Release info not available or assets array empty for tag ${CONFIG.RELEASE_TAG}.`);
        return null;
    }

    const asset = info.assets.find(a => a.name === filename);
    
    // GitHub API automatically redirects to the raw file when calling the download_url
    return asset ? asset.browser_download_url : null;
}


// --- DYNAMIC DATE GENERATION UTILITIES ---
/**
 * Returns the date object for a given offset from today. 0 is today, 1 is yesterday, etc.
 */
function getTargetDate(dayOffset) {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - dayOffset); 
    return targetDate;
}

/**
 * Returns the date formatted as YYYYMMDD for a given Date object.
 */
function formatDateToYYYYMMDD(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

/**
 * Calculates the forecast date based on the run date and a day index (0-6).
 */
function getForecastDate(dayIndex) {
    const year = parseInt(SELECTED_RUNTIME_DATE.substring(0, 4));
    const month = parseInt(SELECTED_RUNTIME_DATE.substring(4, 6)) - 1;
    const day = parseInt(SELECTED_RUNTIME_DATE.substring(6, 8));
    
    // Create the model run date
    const startDate = new Date(year, month, day);
    
    // Calculate the validity date
    const forecastDate = new Date(startDate);
    forecastDate.setDate(startDate.getDate() + dayIndex);
    
    return forecastDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}


// --- GLOBAL STATE ---
const todayYYYYMMDD = formatDateToYYYYMMDD(new Date());
let SELECTED_RUNTIME_DATE = todayYYYYMMDD; // Default to Today
let FORECAST_DATE_STRING = SELECTED_RUNTIME_DATE; 
const NUM_DAYS = 7; // Forecast runs for 7 days (index 0 to 6)
let SELECTED_FORECAST_INDEX = 0; 

let myLeafletMap = null;
let markerLayerGroup = null;
let mapMarkers = []; 
let currentDayIndex = SELECTED_FORECAST_INDEX; 
let currentSiteData = null; 
let SITES = []; 

const TIME_INTERVAL_MINUTES = 10;
const DATA_POINTS_PER_HOUR = 60 / TIME_INTERVAL_MINUTES;
const DATA_POINTS_PER_DAY = 24 * DATA_POINTS_PER_HOUR;


// ====================================================================================
// DYNAMIC UI SETUP FUNCTIONS 

/**
 * Sets up the dynamic date selector for the Model Run Time (Initialization).
 */
function setupDateSelector() {
    const container = document.getElementById('date-selector-container');
    if (!container) return;

    // --- DYNAMIC DATE CALCULATION ---
    const today = new Date();
    
    // Calculate "Today" for the max attribute (YYYY-MM-DD)
    const maxDateStr = today.toISOString().split('T')[0];
    
    // Calculate "3 Days Ago" for the min attribute
    const minDate = getTargetDate(3);
    const minDateStr = minDate.toISOString().split('T')[0];

    // Format current selection for display (YYYY-MM-DD)
    const currentY = SELECTED_RUNTIME_DATE.substring(0, 4);
    const currentM = SELECTED_RUNTIME_DATE.substring(4, 6);
    const currentD = SELECTED_RUNTIME_DATE.substring(6, 8);
    const valueStr = `${currentY}-${currentM}-${currentD}`;

    // Inject HTML with Dynamic Values
    container.innerHTML = `
        <div class="form-group mb-3">
            <label for="runtime-date-selector" class="text-white font-semibold">Forecast Run Time</label>
            <input 
                type="date" 
                class="form-control" 
                id="runtime-date-selector" 
                value="${valueStr}"
                min="${minDateStr}"
                max="${maxDateStr}"
            >
            <small class="text-light" style="font-size: 0.8rem;">
                Selectable range: Today back to Day -3
            </small>
        </div>
    `;

    // Event Listener
    document.getElementById('runtime-date-selector').addEventListener('change', (event) => {
        const newDate = event.target.value.replace(/-/g, '');
        
        // Simple check to ensure date is within the allowed range
        if (newDate > todayYYYYMMDD || newDate < formatDateToYYYYMMDD(getTargetDate(3))) {
             alert("Selected date is outside the allowed run time range (Today back to Day -3).");
             event.target.value = valueStr; // Revert to previous valid date
             return; 
        }
        
        SELECTED_RUNTIME_DATE = newDate;
        FORECAST_DATE_STRING = newDate;

        // Clean up map and re-fetch data
        if (myLeafletMap) {
            mapMarkers.forEach(marker => myLeafletMap.removeLayer(marker));
            mapMarkers = [];
        }
        fetchAndProcessAllSites();
        
        // Update the Forecast Horizon label/date because the base date changed
        const sliderVal = document.getElementById('forecast-day-slider').value;
        window.handleDaySelection(parseInt(sliderVal)); 
    });
}

/**
 * Sets up the dynamic slider for the Forecast Horizon (Validity Date).
 */
function setupForecastHorizonSlider() {
    const container = document.getElementById('forecast-horizon-container');
    if (!container) return;

    const initialValidityDate = getForecastDate(SELECTED_FORECAST_INDEX);

    container.innerHTML = `
        <div class="form-group mb-3">
            <label for="forecast-day-slider" class="text-white font-semibold d-flex justify-content-between align-items-center">
                <span>Forecast Horizon</span>
                <span id="forecast-day-badge" class="badge badge-primary">Day +${SELECTED_FORECAST_INDEX}</span>
            </label>
            
            <input 
                type="range" 
                class="form-control-range" 
                id="forecast-day-slider" 
                min="0" 
                max="${NUM_DAYS - 1}" 
                value="${SELECTED_FORECAST_INDEX}"
                step="1"
            >
            
            <div class="mt-2 p-2 bg-secondary rounded text-center">
                <small class="text-light">Validity Date:</small><br>
                <strong id="dynamic-val-date" class="text-white" style="font-size: 1.1em;">${initialValidityDate}</strong>
            </div>
        </div>
    `;

    document.getElementById('forecast-day-slider').addEventListener('input', (event) => {
        const index = parseInt(event.target.value);
        window.handleDaySelection(index);
    });
}

// ====================================================================================
// UTILITY & DATA FUNCTIONS
// ====================================================================================

function classifyRisk(twl, thresh, risk_classes) {
    if (twl < thresh) return "No Flood";
    if (twl < risk_classes[0]) return "Warning";
    if (twl < risk_classes[1]) return "High Risk";
    return "Severe Flood";
}

function transformRawSites(rawData) {
    return Object.entries(rawData).map(([id, data]) => {
        const siteIdName = id.replace(/-/g, ' ').toUpperCase(); 
        const displayName = `${data.city} (${siteIdName})`;

        return {
            id: id,
            name: displayName,
            lat: data.lat_cible, 
            lng: data.lon_cible, 
            threshold: data.threshold, 
            risk_class: data.risk_class, 
            forecastData: null
        };
    });
}

/**
 * Fetches and parses the forecast CSV for a single site.
 */
async function fetchAndParseForecast(site) {
    const siteId = site.id; // e.g., "TWL_Baguida_TOGO"
    // SELECTED_RUN_DATE is assumed to be a global variable (e.g., '2025-12-06') and is converted to the required file format (e.g., '20251206').
    const runDate = SELECTED_RUN_DATE.replace(/-/g, '');

    // The actual files use a short ID (e.g., TOGO), which is the last part of the site ID.
    const parts = siteId.split('_');
    const shortId = parts[parts.length - 1];

    const assetName = `all_twl_data_${shortId}_${runDate}.csv`;
    
    // Fetch GitHub URL only
    const finalUrl = await getAssetDownloadUrl(assetName);

    if (!finalUrl) {
        console.warn(`Forecast Asset ${assetName} not found on GitHub release. Returning empty data.`);
        // If the main forecast file is missing, we must return empty data
        return { ...site, forecastData: { daily: [], hourly: [] } };
    }

    try {
        const response = await fetch(finalUrl);
        
        if (!response.ok) {
            console.warn(`Forecast data failed to download for ${site.name} from ${finalUrl}. Status: ${response.status}`);
            return { ...site, forecastData: { daily: [], hourly: [] } };
        }

        const csvText = await response.text();
        const forecastData = parseForecastCSV(csvText, site);
        
        return { ...site, forecastData: forecastData };

    } catch (error) {
        console.error(`Network error fetching forecast for ${site.name} from ${finalUrl}:`, error);
        return { ...site, forecastData: { daily: [], hourly: [] } };
    }
}

function parseForecastCSV(csvText, site) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return { daily: [], hourly: [] };

    const header = lines[0].split(',');
    const twlColumnIndex = header.findIndex(h => h.trim().toLowerCase() === 'total_water_level');
    
    if (twlColumnIndex === -1) {
        console.warn(`TWL column not found in CSV header for ${site.id}. Skipping.`);
        return { daily: [], hourly: [] };
    }
    
    const dataRows = lines.slice(1);
    const rawTWLData = [];

    dataRows.forEach(line => {
        const cols = line.split(',');
        if (cols.length > twlColumnIndex) { 
            const timestamp = cols[0];
            const twl = parseFloat(cols[twlColumnIndex]);
            if (!isNaN(twl)) {
                rawTWLData.push({ timestamp: timestamp, twl: twl });
            }
        }
    });

    // 1. Prepare Daily Summary (7 days)
    const dailyData = [];
    for (let i = 0; i < NUM_DAYS; i++) {
        const startIdx = i * DATA_POINTS_PER_DAY;
        const endIdx = startIdx + DATA_POINTS_PER_DAY;
        const dayTWLData = rawTWLData.slice(startIdx, endIdx);

        if (dayTWLData.length < DATA_POINTS_PER_DAY / 4) break; 

        const max_twl = dayTWLData.reduce((max, item) => Math.max(max, item.twl), 0);
        const risk = classifyRisk(max_twl, site.threshold, site.risk_class);
        
        const fullDate = getForecastDate(i);
        
        dailyData.push({
            date: fullDate.split(',')[1].trim(), 
            fullDate: fullDate,
            max_water_level: parseFloat(max_twl.toFixed(3)),
            risk: risk
        });
    }

    // 2. Prepare Hourly Data (1-hour resolution from the 10-min data)
    const fullHourlyData = rawTWLData
        .filter((_, index) => index % DATA_POINTS_PER_HOUR === 0)
        .map(item => parseFloat(item.twl.toFixed(3)));

    return { daily: dailyData, hourly: fullHourlyData };
}

/**
 * Main function to fetch all data, called when the model run time changes.
 */
async function fetchAndProcessAllSites() {
    // *** NOTE: Ensure getAssetDownloadUrl() is defined and working ***
    
    try {
        const sitesFilename = CONFIG.SITES_FILENAME; 
        
        // 1. Attempt to get the GitHub URL for sites_file.json
        const githubSitesUrl = await getAssetDownloadUrl(sitesFilename);
        
        // 2. Define the local path (uses BASE_PATH and FILENAME)
        const localSitesUrl = CONFIG.DATA_BASE_PATH + sitesFilename;
        
        // 3. Prioritize GitHub URL. If null, use the local path.
        const finalSitesUrl = githubSitesUrl || localSitesUrl;

        if (!githubSitesUrl) {
            console.warn(`Sites configuration file NOT found on GitHub release. Attempting local path: ${finalSitesUrl}`);
        } else {
             console.log(`Fetching sites configuration from GitHub URL: ${finalSitesUrl}`);
        }

        // 4. Fetch the sites configuration file
        let sitesResponse = await fetch(finalSitesUrl);
        let rawSitesData;
        let finalLoadUrl = finalSitesUrl;
        
        // MODIFICATION START: Implement robust fallback logic
        if (!sitesResponse.ok) {
            // Check if we were trying the GitHub URL and it failed
            if (githubSitesUrl && finalSitesUrl === githubSitesUrl) {
                console.warn(`GitHub fetch for sites_file.json failed (${sitesResponse.status} ${sitesResponse.statusText}). Retrying with local path: ${localSitesUrl}`);
                
                // --- SECOND ATTEMPT WITH LOCAL PATH ---
                sitesResponse = await fetch(localSitesUrl);
                finalLoadUrl = localSitesUrl;

                if (!sitesResponse.ok) {
                    // Both GitHub and local fetch failed
                    throw new Error(`Failed to load ${sitesFilename}. Final URL tried: ${finalLoadUrl}. Status: ${sitesResponse.status} ${sitesResponse.statusText}`);
                }
                console.log("Successfully loaded sites configuration from local path.");

            } else {
                // We were already trying the local path and it failed
                throw new Error(`Failed to load ${sitesFilename}. Final URL tried: ${finalLoadUrl}. Status: ${sitesResponse.status} ${sitesResponse.statusText}`);
            }
        }
        // MODIFICATION END

        rawSitesData = await sitesResponse.json();
        let tempSites = transformRawSites(rawSitesData);
        
        // Concurrently fetch forecast data for all sites
        const fetchPromises = tempSites.map(site => fetchAndParseForecast(site));
        const results = await Promise.all(fetchPromises);
        
        SITES = results;
        
        if (SITES.length > 0) {
            populateMapMarkers(); 
            populateUIControls(); 

            // Trigger the historical tab to initialize now that site data exists
            const histSelect = document.getElementById('site_hist');
            if (histSelect) {
                histSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            // Set initial site for sidebar if none is selected
            if (!currentSiteData || !SITES.find(s => s.id === currentSiteData.id)) {
                currentSiteData = SITES[0];
            }

            // Render current state
            window.handleDaySelection(SELECTED_FORECAST_INDEX);
        } else {
            throw new Error("No sites loaded or no data available for selected run date.");
        }

    } catch (error) {
        console.error("Fatal error during data fetch:", error);
        document.getElementById('forecast-table-body').innerHTML = `
            <tr><td colspan="3" class="text-center py-4 text-danger">
                <strong>Data Error:</strong> ${error.message}
            </td></tr>`;
    }
}

// ====================================================================================
// MAP AND UI RENDERING
// ====================================================================================

function initializeMap() {
    if (myLeafletMap) return;

    myLeafletMap = L.map('map', {zoomControl : true}).setView([5.0, 2.0], 6);
    markerLayerGroup = L.layerGroup().addTo(myLeafletMap); 

    // ----- BASEMAPS -----------------------------------------------------
    // ESRI Satellite
    const esriSatellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri", maxZoom: 19 }
    );
    const esriBoundaries = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { attribution: "© Esri", maxZoom: 19 }
    );
    const esriLabels = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
        { subdomains: "abcd", maxZoom: 19 }
    );
    // OSM Standard
    const osmStandard = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: "© OpenStreetMap contributors", maxZoom: 19 }
    );
    // ESRI Labels overlay (optional, not a basemap)
    const esriHybrid = L.layerGroup([esriSatellite, esriBoundaries]);

    // Add default basemap
    esriHybrid.addTo(myLeafletMap);

    // ----- LAYER SWITCHER ------------------------------------------------
    const baseMaps = {"ESRI Satellite": esriHybrid,"OSM Standard": osmStandard};
    const overlayMaps = {"Forecast Sites": markerLayerGroup};
    // Add layer control to the map
    L.control.layers(baseMaps, overlayMaps, { collapsed: true }).addTo(myLeafletMap);
}

function createMarkerIcon(risk) {
    const color = RISK_COLORS[risk];
    const isSevere = risk === "Severe Flood";
    
    const markerHtml = `
        <div class="${isSevere ? 'pulse-severe' : ''}" style="
            background-color: ${color};
            width: 25px;
            height: 25px;
            border-radius: 50%;
            border: 1px solid white;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
        "></div>
    `;

    return L.divIcon({
        className: 'custom-marker',
        html: markerHtml,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });
}

function populateMapMarkers() {
    // Clear existing markers
    mapMarkers.forEach(marker => myLeafletMap.removeLayer(marker));
    mapMarkers = [];

    SITES.forEach(site => {
        // Markers will be updated by handleDaySelection() after this
        const initialRisk = "N/A";
        const initialIcon = createMarkerIcon(initialRisk);

        const marker = L.marker([site.lat, site.lng], { site: site, icon: initialIcon }).addTo(myLeafletMap);
        mapMarkers.push(marker);
        marker.bindTooltip(`<b>${site.name}</b>`, {direction: 'top', offset: [0, -10]});
        
        marker.on('click', () => {
            updateSidebar(site);
            myLeafletMap.flyTo([site.lat, site.lng], 9, { duration: 1.0 });
            showChartPopup(site, marker);
        });
    });
}

function populateUIControls() {
    // Populate Historical Site Selects
    const siteSelects = document.querySelectorAll('#site_hist');
    siteSelects.forEach(select => {
        select.innerHTML = SITES.map(site => 
            `<option value="${site.id}">${site.name}</option>`
        ).join('');
    });
}

function renderMapMarkers(dayIndex) {
    mapMarkers.forEach(marker => {
        const site = marker.options.site;
        const data = site.forecastData;

        let risk = "N/A";
        if (data && data.daily.length > dayIndex && data.daily[dayIndex]) {
            risk = data.daily[dayIndex].risk;
        }

        const icon = createMarkerIcon(risk);
        marker.setIcon(icon);
    });
}

function renderRiskLegend() {
    const legendContent = document.getElementById('legend_content');
    legendContent.innerHTML = VIGILANCE_LEVELS.map(config => `
        <div class="legend-item">
            <div class="legend-color-box" style="background-color: ${config.color};"></div>
            <div>
                <strong>${config.level}</strong><br>
                <small>${config.description}</small>
            </div>
        </div>
    `).join('');
}


function updateSidebar(site) {
    currentSiteData = site;
    const data = site.forecastData;
    
    document.getElementById('stat-site-name').innerText = site.name;
    document.getElementById('location-subtitle').innerText = `Site Threshold: ${site.threshold}m`;

    if (!data || data.daily.length === 0) {
        document.getElementById('stat-twl').innerText = "-- m";
        const riskEl = document.getElementById('stat-risk');
        riskEl.innerText = "No Data";
        riskEl.style.color = RISK_COLORS["N/A"];
        document.getElementById('forecast-table-body').innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400 italic">Data not available for ${site.name}</td></tr>`;
        return;
    }

    const selectedDayStatus = data.daily[currentDayIndex];
    if (!selectedDayStatus) return;

    document.getElementById('stat-twl').innerText = `${selectedDayStatus.max_water_level} m`;
    
    const riskEl = document.getElementById('stat-risk');
    riskEl.innerText = selectedDayStatus.risk;
    riskEl.style.color = RISK_COLORS[selectedDayStatus.risk];

    const tableBody = document.getElementById('forecast-table-body');
    tableBody.innerHTML = '';
    
    data.daily.forEach((day, index) => {
        const colorCode = RISK_COLORS[day.risk];
        const badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider" style="background-color: ${colorCode}">${day.risk.replace(' ', '&nbsp;')}</span>`;
        const isSelected = index === currentDayIndex ? 'bg-info border-info' : 'hover:bg-slate-50'; // Using info for selection
        
        let dateCellText = day.fullDate.split(',')[0].trim(); // Weekday name

        const row = `
            <tr class="border-b border-slate-50 last:border-0 transition ${isSelected}">
                <td class="px-2 py-2 font-medium text-slate-700">${dateCellText}</td>
                <td class="px-2 py-2 text-slate-600">${day.max_water_level} m</td>
                <td class="px-2 py-2">${badge}</td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}


function showChartPopup(site, marker) {
    const data = site.forecastData;
    
    if (!data || data.hourly.length === 0) {
        L.popup()
            .setLatLng(marker.getLatLng())
            .setContent(`<div class="p-2 text-center text-red-600 font-semibold">Hourly chart data not available for this site.</div>`)
            .openOn(myLeafletMap);
        return;
    }
    
    myLeafletMap.closePopup();

    //const startHour = currentDayIndex * 24;
    //const endHour = startHour + 24;
    
    //const daysHourlyData = data.hourly.slice(startHour, endHour);
    const daysHourlyData = data.hourly;   // Use full timeline
    //const displayDate = getForecastDate(currentDayIndex);
    const displayDate = `${getForecastDate(0)} → ${getForecastDate(data.hourly.length/24 - 1)}`;

    const chartHtml = `
        <div class="chart-popup-container">
            <h5 class="text-sm font-semibold text-slate-700 text-center mb-1">
                ${site.name}<br>
                <span class="text-xs text-slate-500 font-normal">${displayDate}</span>
            </h5>
            <canvas id="popupChartCanvas"></canvas>
        </div>
    `;
    
    const popup = L.popup({ 
        closeButton: true, 
        minWidth: 350, 
        maxWidth: 550,
        autoClose: true,
        className: 'water-level-popup'
    })
    .setLatLng(marker.getLatLng())
    .setContent(chartHtml)
    .openOn(myLeafletMap);
    
    popup.on('remove', () => {
        const canvas = document.getElementById('popupChartCanvas');
        if (canvas) canvas.remove();
    });

    setTimeout(() => {
        const ctx = document.getElementById('popupChartCanvas');
        if (!ctx) return;
        new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: Array.from({length: daysHourlyData.length}, (_, i) => i % 4 === 0 ? `${i}h` : ''), 
                datasets: [{
                    label: 'TWL (m)',
                    data: daysHourlyData, 
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0, 
                }, {
                    label: 'Threshold (m)',
                    data: Array(daysHourlyData.length).fill(site.threshold),
                    borderColor: RISK_COLORS["High Risk"],
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: { 
                    y: { 
                        ticks: { font: { size: 10 } },
                        title: {
                            display: true,
                            text: 'Total Water Level (m)',
                            font: { size: 12, weight: 'bold' }
                        }
                    }, 
                    x: { 
                        ticks: { font: { size: 10 } },
                        title: {
                            display: true,
                            text: 'Time (Hours)',
                            font: { size: 12, weight: 'bold' }
                        }
                    } 
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }, 50);
}


// ========================================
// INTERACTION HANDLERS 
/**
 * Handles all UI updates when the forecast day slider is moved.
 */
window.handleDaySelection = function(value) {
    const newIndex = parseInt(value, 10);
    currentDayIndex = newIndex; 
    SELECTED_FORECAST_INDEX = newIndex; 

    // 1. Update the slider badge and validity date display
    const badge = document.getElementById('forecast-day-badge');
    if (badge) badge.innerText = `Day +${newIndex}`;
    
    const dateBox = document.getElementById('dynamic-val-date');
    if(dateBox) dateBox.innerText = getForecastDate(newIndex);
    
    // 2. Update the slider position itself
    const slider = document.getElementById('forecast-day-slider');
    if (slider) slider.value = newIndex;

    // 3. Update Map Markers (Risk status)
    if (myLeafletMap) renderMapMarkers(currentDayIndex);
    
    // 4. Update Sidebar Stats (Max TWL, Risk)
    if (currentSiteData) {
        const selectedSite = SITES.find(s => s.id === currentSiteData.id);
        if (selectedSite) updateSidebar(selectedSite);
    } 

    // 5. Close any open chart popup (as it refers to the old day)
    if (myLeafletMap) myLeafletMap.closePopup();
}

// =================================================
// TAB SWITCHING AND HISTORICAL LOGIC

function setupTabSwitching() {
    const forecastTab = document.getElementById('nav-forecast');
    const historicalTab = document.getElementById('nav-historical');
    const forecastContent = document.getElementById('tab-forecast');
    const historicalContent = document.getElementById('tab-historical');

    function switchTab(target) {
        if (target === 'forecast') {
            forecastContent.style.display = 'block';
            historicalContent.style.display = 'none';
            forecastTab.classList.add('active');
            historicalTab.classList.remove('active');
            if (myLeafletMap) {
                myLeafletMap.invalidateSize(); 
            }
        } else {
            forecastContent.style.display = 'none';
            historicalContent.style.display = 'block';
            historicalTab.classList.add('active');
            forecastTab.classList.remove('active');
            
            // Re-render historical plot on switch
            const initialGraph = document.querySelector('input[name="graph_hist"]:checked')?.value || 'bubble';
            const initialSite = document.getElementById('site_hist')?.value;
            const initialEvent = document.getElementById('event')?.value.split(' ')[0];
            if (initialSite) renderHistoricalPlot(initialGraph, initialSite, initialEvent);
        }
    }

    forecastTab.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('forecast');
    });

    historicalTab.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('historical');
    });
}


// ------------------------------------------------------------------------------------
// UPDATED HISTORICAL REACTIVITY AND DATA MOCKS
// ------------------------------------------------------------------------------------

// --- GLOBAL CACHE FOR HISTORICAL EVENTS ---
const EVENT_DATA_CACHE = {};

/**
 * Parses the Xtrem_all_var CSV data.
 * Expected columns: Date (YYYY-MM-DD format), peak_value, Tide_10min, SSH_10min, Wave_Runup.
 */
function parseXtremEventCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    // --- 1. Parse header safely (strip quotes, lowercase) ---
    const header = lines[0].replace(/"/g, '').split(',').map(h => h.trim().toLowerCase());
    
    // Attempt to map column names
    const dateIdx = header.findIndex(h => h.includes('peak_date_time'));
    const twlIdx = header.findIndex(h => h.includes('peak_value'));
    const tideIdx = header.findIndex(h => h.includes('tide'));
    const surgeIdx = header.findIndex(h => h.includes('ssh'));
    const runupIdx = header.findIndex(h => h.includes('runup'));
    const hsIdx = header.findIndex(h => h.includes('significant'));
    const durIdx = header.findIndex(h => h.includes('duration_hours'));


    if (dateIdx === -1 || twlIdx === -1) {
        console.error("Missing required columns (Date or TWL) in Xtrem CSV.");
        return [];
    }
    
    const events = [];
    lines.slice(1).forEach(line => {
        const cols = line.split(',');
        
        const dateStr = cols[dateIdx]?.trim().replace(/"/g, '');
        const twlPeak = parseFloat(cols[twlIdx]?.trim().replace(/"/g, ''));
        
        // Components extraction
        const tide = parseFloat(cols[tideIdx]?.trim().replace(/"/g, '')) || 0;
        let surge = parseFloat(cols[surgeIdx]?.trim().replace(/"/g, '')) || 0;
        const runup = parseFloat(cols[runupIdx]?.trim().replace(/"/g, '')) || 0;
        const hsig = parseFloat(cols[hsIdx]?.trim().replace(/"/g, '')) || 0; 
        const durh = parseFloat(cols[durIdx]?.trim().replace(/"/g, '')) || 0; 

        // If 'Surge' is missing or looks incorrect, calculate as residual
        if (surgeIdx === -1 || surge <= 0 || (surge + tide + runup) > twlPeak * 1.05) { 
             surge = parseFloat((twlPeak - tide - runup).toFixed(3));
        }

        if (dateStr && !isNaN(twlPeak) && twlPeak > 0 && tide >= 0 && surge >= 0 && runup >= 0) {
            events.push({
                id: dateStr,
                name: `${dateStr} (Peak TWL: ${twlPeak.toFixed(2)}m)`,
                // Order: Tide , Storm Surge, Wave Setup/Runup
                twl_components: [tide, surge, runup],
                twl_peak: twlPeak,
                Hs: hsig,
                dur_h:durh
            });
        }
    });
    return events;
}

/**
 * Fetches and parses the Xtrem events catalog for a given site, using a cache.
 */
async function fetchAndParseXtremEvents(siteId) {
    if (EVENT_DATA_CACHE[siteId]) {
        return EVENT_DATA_CACHE[siteId];
    }
    
    const assetName = `Xtrem_all_var_${siteId}.csv`;
    
    // Fetch GitHub URL only
    const finalUrl = await getAssetDownloadUrl(assetName);

    if (!finalUrl) {
        console.warn(`Xtrem event catalog (${assetName}) not found on GitHub release for ${siteId}. Returning empty data.`);
        EVENT_DATA_CACHE[siteId] = { count: 0, events: [] };
        return EVENT_DATA_CACHE[siteId];
    }
    
    try {
        const response = await fetch(finalUrl);
        
        if (!response.ok) {
            console.warn(`Xtrem event catalog failed to download for ${siteId} from ${finalUrl}. Status: ${response.status}`);
            EVENT_DATA_CACHE[siteId] = { count: 0, events: [] };
            return EVENT_DATA_CACHE[siteId];
        }

        const csvText = await response.text();
        const events = parseXtremEventCSV(csvText);
        
        // Sort events by date descending
        events.sort((a, b) => new Date(b.id) - new Date(a.id));
        
        const result = {
            count: events.length,
            events: events
        };
        
        EVENT_DATA_CACHE[siteId] = result;
        return result;

    } catch (error) {
        console.error(`Network error fetching Xtrem events for ${siteId} from ${finalUrl}:`, error);
        EVENT_DATA_CACHE[siteId] = { count: 0, events: [] };
        return EVENT_DATA_CACHE[siteId];
    }
}

/**
 * Public function to get event data for a site.
 */
async function getSiteEvents(siteId) {
    return fetchAndParseXtremEvents(siteId);
}

// ====================================================================================\
// HISTORICAL DATA FETCHERS (Using Xtrem data)
// ====================================================================================\

// 2.1 Joint Probability Data
async function fetchJointProbabilityData(siteId) {
    const eventData = await fetchAndParseXtremEvents(siteId);
    // Check if data is empty to prevent issues with .map()
    if (eventData.count === 0) {
        return { tide_sla: [], hs: [], twl_peak: [], dates: [], dur_h: [] };
    }

    return { 
        tide_sla: eventData.events.map(e => e.twl_components[0]),
        hs: eventData.events.map(e => e.Hs),
        twl_peak: eventData.events.map(e => e.twl_peak),
        dates: eventData.events.map(e => e.id),
        dur_h: eventData.events.map(e => e.dur_h),
    };
}

// 2.2 Seasonal Variability Data
async function fetchSeasonalData(siteId) {
    const eventData = await fetchAndParseXtremEvents(siteId);
    const events = eventData.events;
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTWL = {};
    months.forEach(m => monthlyTWL[m] = []);

    events.forEach(event => {
        // We use the event ID (YYYY-MM-DD) to get the month
        const date = new Date(event.id);
        const monthIndex = date.getMonth(); // 0-11
        const monthName = months[monthIndex];
        monthlyTWL[monthName].push(event.twl_peak);
    });

    return monthlyTWL;
}

// 2.3 Interannual Variability Data
async function fetchInterannualData(siteId) {
    const eventData = await fetchAndParseXtremEvents(siteId);
    const events = eventData.events;
    
    const yearlyData = {}; // Structure: {2018: {max_twl: 2.3, events_count: 3}, ...}

    events.forEach(event => {
        const year = new Date(event.id).getFullYear();
        const twl = event.twl_peak;
        
        if (!yearlyData[year]) {
            yearlyData[year] = { max_twl: twl, events_count: 0 };
        }
        
        yearlyData[year].events_count += 1;
        // Update annual max TWL
        yearlyData[year].max_twl = Math.max(yearlyData[year].max_twl, twl);
    });
    
    // Sort by year for correct plotting order
    const sortedYears = Object.keys(yearlyData).sort((a, b) => a - b);
    
    return {
        years: sortedYears.map(y => parseInt(y)),
        max_twl: sortedYears.map(y => parseFloat(yearlyData[y].max_twl.toFixed(3))),
        events_count: sortedYears.map(y => yearlyData[y].events_count)
    };
}

// 2.4 Event Component Data (Bar Plot)
async function fetchEventComponentData(siteId, eventId) {

    const eventData = EVENT_DATA_CACHE[siteId]; 
    if (!eventData) return { components: [], contributions: [] };

    const event = eventData.events.find(e => e.id === eventId);
    if (!event) return { components: [], contributions: [] };

    // Components labels matching the order [Tide, Surge, Runup]
    const components = ['Tide ', 'SSH', 'Wave Runup'];
    const contributions = event.twl_components; 
    
    return { components, contributions, twlPeak: event.twl_peak };
}

/* DELETE ANALYSIS time series
// 2.5 Event Timeseries Data (Still Mock)
async function fetchEventTimeseriesData(siteId, eventId) {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const count = 72; // 3 days * 24 hours
    const mockTime = Array.from({length: count}, (_, i) => new Date(new Date().getTime() - (count - i) * 3600000).toISOString());
    const event = EVENT_DATA_CACHE[siteId]?.events.find(e => e.id === eventId);
    const peakTwl = event ? event.twl_peak : 2.0;

    // Simplified mock time series data that peaks at the expected TWL for the selected event
    const twl_series = mockTime.map((_, i) => {
        const factor = 1 - Math.abs(i - count / 2) / (count / 2) * 0.5; // Taper off from middle
        return 1.0 + (peakTwl - 1.0) * factor * (0.8 + Math.random() * 0.4);
    });

    const hs_series = twl_series.map(t => (t / 4) * (0.8 + Math.random() * 0.4));
    const tide_series = twl_series.map(t => t * 0.6 * (0.9 + Math.random() * 0.2));

    return {
        time: mockTime,
        TWL: twl_series,
        Hs: hs_series,
        Tide: tide_series,
        Runup: twl_series.map((twl, i) => twl - tide_series[i] - hs_series[i] * 0.1) // Mock Runup/Surge
    };
}
*/

// 2.5 Fetch pre-calculated variability analysis
async function fetchVariabilityAnalysis(siteId) {
    const filename = `Variability_Analysis_${siteId}.json`;
    
    // Fetch GitHub URL only
    const finalUrl = await getAssetDownloadUrl(filename);

    if (!finalUrl) {
        throw new Error(`No variability analysis data (${filename}) found on GitHub Release for ${siteId}.`);
    }

    const response = await fetch(finalUrl);

    if (!response.ok) {
        throw new Error(`Failed to fetch variability analysis JSON from GitHub: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// ====================================================================================
// UI REACTIVITY (Fixes for event analysis not displaying)
// ====================================================================================

async function setupHistoricalReactivity() {
    const controls = document.getElementById('historical-controls');
    const eventGroup = document.getElementById('event-selection-group');
    const eventSelect = document.getElementById('event');
    const eventCountDisplay = document.getElementById('total-events-display');
    const siteSelect = document.getElementById('site_hist');

    // Helper function to populate the event UI
    async function updateEventUI(siteId) {
        const eventData = await getSiteEvents(siteId);
        
        eventCountDisplay.innerText = eventData.count;
        
        eventSelect.innerHTML = eventData.events.map(event => 
            `<option value="${event.id}">${event.name}</option>`
        ).join('');
        
        if (eventData.events.length === 0) {
            eventSelect.innerHTML = '<option value="">No Events Available</option>';
            eventSelect.disabled = true;
        } else {
            eventSelect.disabled = false;
        }
        
        // Return the first event ID or null
        return eventData.events.length > 0 ? eventData.events[0].id : null;
    }

    // Handle changes to controls
    controls.addEventListener('change', async (event) => {
        const graphType = document.querySelector('input[name="graph_hist"]:checked').value;
        const site = siteSelect.value;
        let currentEventId = eventSelect.value;
        
        // Update event dropdown only when site changes
        if (event.target.id === 'site_hist') {
            currentEventId = await updateEventUI(site); 
        }

        // Show/Hide Event Selection based on plot type  
        const requiresEvent = (graphType === 'bar'); //const requiresEvent = (graphType === 'bar' || graphType === 'time_series');
        eventGroup.style.display = requiresEvent ? 'block' : 'none';
        
        // Plot logic
        if (requiresEvent && !currentEventId) {
             // Display warning if event analysis is selected but no events exist
             const plotDiv = document.getElementById('Historical_plot');
             Plotly.purge(plotDiv); 
             plotDiv.innerHTML = `<div class="p-5 text-center text-xl text-warning">No historical events are available for this site.</div>`;
        } else {
            renderHistoricalPlot(graphType, site, currentEventId);
        }
    });
}

// --- UPDATED RENDER PLOT FUNCTION ---

async function renderHistoricalPlot(graphType, siteId, eventId) {
    const plotDiv = document.getElementById('Historical_plot');
    Plotly.purge(plotDiv); 

    const site = SITES.find(s => s.id === siteId);
    if (!site) {
        plotDiv.innerHTML = `<div class="p-5 text-center text-xl text-danger">Error: Site not found.</div>`;
        return;
    }
    
    let plotData = [];
    let layout = {};

    try {
        if (graphType === 'bubble') {
            // --- JOINT PROBABILITY (Hs vs Tide) ---
            const data = await fetchJointProbabilityData(siteId);
            
            if (data.tide_sla.length === 0) throw new Error("No Joint Probability data available.");

            const twlValues = data.twl_peak;
            const minTWL = Math.min(...twlValues.filter(v => v > 0), 1.0);
            const maxTWL = Math.max(...twlValues.filter(v => v > 0), 2.5); // Use 2.5m as a floor if data is sparse

            plotData = [{
                x: data.tide_sla,
                y: data.hs,
                mode: 'markers',
                type: 'scatter',
                marker: {
                    // Adjust size for better visibility, scaled by TWL size: twlValues.map(twl => Math.max(8, twl * 15)),
                    size: data.dur_h.map(d => d/2),
                    // Continuous color mapping for TWL
                    color: twlValues, 
                    
                    // Define the continuous colormap settings
                    colorscale: 'Viridis', // A standard, good-contrast colormap (e.g., Viridis, Plasma, Jet)
                    colorbar: {
                        title: 'TWL (m) / Size (Duration (h))',
                        titleside: 'right',
                        thickness: 20, 
                        len: 0.9,
                        cmin: minTWL,
                        cmax: maxTWL
                    },
                    opacity: 0.8,
                    line: { color: 'rgba(0,0,0,0.5)', width: 1 }
                },
                text: data.twl_peak.map((twl, i) => {
                    const tide = data.tide_sla[i];
                    const hs = data.hs[i];
                    const date = data.dates[i];
                    const duration=data.dur_h[i];
                    return `Date: ${date}<br>TWL: ${twl.toFixed(3)}m<br>Tide: ${tide.toFixed(3)}m<br>Hs: ${hs.toFixed(3)}m<br>Duration: ${duration.toFixed(2)}h`;
                }),
                hoverinfo: 'text',
                name: 'Coastal Flood Events'
            }];

            layout = {
                title: `Tide vs. Hs Distribution for ${site.name}`,
                xaxis: { title: 'Tide (m)' },
                yaxis: { title: 'Significant Wave Height (Hs) (m)' },
                legend: {
                    title: { text: "Size (Duration )" }
                },
                height: 800,
                margin: {t: 50, b: 70, l: 70, r: 20},
                showlegend: false
            };
        }
        
        else if (graphType === 'seasonal') {
            // --- SEASONAL VARIABILITY (Box Plot) ---
            const data = await fetchSeasonalData(siteId);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            
            plotData = months.filter(m => data[m] && data[m].length > 0).map(month => ({
                y: data[month],
                name: month,
                type: 'box',
                boxpoints: 'all',
                marker: { color: '#1f78b4' },
                line: { color: '#1f78b4' }
            }));

            layout = {
                title: `Seasonal Variability of TWL for ${site.name}`,
                xaxis: { title: 'Month' },
                yaxis: { title: 'Total Water Level (TWL) (m)' },
                height: 800,
                margin: {t: 50, b: 70, l: 70, r: 20},
                showlegend: false
            };
        }
        
        else if (graphType === 'interannual') {
            // --- INTERANNUAL VARIABILITY (Bar Chart) ---
            const data = await fetchInterannualData(siteId);
            
            plotData = [
                {
                    x: data.years,
                    y: data.max_twl,
                    type: 'bar',
                    name: 'Annual Max TWL (m)',
                    marker: { color: '#33a02c'}
                },
                {
                    x: data.years,
                    y: data.events_count,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Number of Events',
                    yaxis: 'y2',
                    line: { color: '#e31a1c'  }
                }
            ];

            layout = {
                title: `Interannual Variability of Flood Events and Max TWL for ${site.name}`,
                xaxis: { title: 'Year' },
                yaxis: { title: 'Annual Maximum TWL (m)', color: '#33a02c'},
                yaxis2: {
                    title: 'Number of Flood Events',
                    overlaying: 'y',
                    side: 'right',
                    color: '#e31a1c' ,
                    showgrid: false
                },
                legend: { x: 0, y: 1.15, orientation: 'v' },
                height: 800,
                margin: {t: 70, b: 70, l: 70, r: 70}
            };
        }
        
        else if (graphType === 'bar') {
            // --- EVENT COMPONENT CONTRIBUTION (Bar Chart) ---
            const data = await fetchEventComponentData(siteId, eventId);
            
            if (data.contributions.length === 0) throw new Error("No component data available.");

            // 1. Calculate sum to determine percentages
            const sumComponents = data.contributions.reduce((a, b) => a + b, 0);
            // 2. Generate percentage labels (e.g., "45.2%")
            const percentLabels = data.contributions.map(val => 
                ((val / sumComponents) * 100).toFixed(1) + '%'
            );

            // Use twlPeak from fetched data, or calculate sum
            const totalTWL = data.twlPeak ? data.twlPeak.toFixed(2) : data.contributions.reduce((a, b) => a + b, 0).toFixed(2);
            
            plotData = [{
                x: data.components,
                y: data.contributions,
                type: 'bar',
                marker: { color: ['#ff7f0e','#1f77b4', '#2ca02c'] }, //Tide(Orange), SSH(Blue),  Runup(Green)
                // --- Add Percentage Labels ---
                text: percentLabels,
                textposition: 'auto', // Puts label inside if it fits, outside if not
                hoverinfo: 'x+y+text', // Show label on hover too
                textfont: {
                    size: 14,
                    color: 'auto' // Automatically picks black or white for contrast
                }
            }];

            layout = {
                title: `Component Contribution for ${site.name} (Flood Event of: ${eventId}) <br> Max TWL: ${totalTWL} m`,
                xaxis: { title: 'TWL Component' },
                yaxis: { title: 'Water level (m)' },
                height: 800,
                margin: {t: 70, b: 70, l: 70, r: 20},
                legend: { x: 0, y: 1.15, orientation: 'v' },
            };
        }

        // --- NEW BLOCKS FOR TWL seasonal, trend and all series plot ---
        else if (graphType === 'variance_series') {
            const varData = await fetchVariabilityAnalysis(siteId);
            if (!varData) throw new Error("Variability data not found for this site.");

            plotData = [{
                x: varData.series_variance.labels,
                y: varData.series_variance.values,
                type: 'bar',
                marker: { color: ['#1f77b4', '#ff7f0e', '#2ca02c'] }, // SSH(Blue), Tide(Orange), Runup(Green)
                text: varData.series_variance.values.map(v => v.toFixed(1) + '%'),
                textposition: 'auto'
            }];

            layout = {
                title: `Variance Contribution to TWL (All Time Scale) - ${site.name}`,
                xaxis: { title: 'Component' },
                yaxis: { title: 'Percentage Contribution (%)' },
                height: 800
            };
        }
        else if (graphType === 'variance_seasonal') {
            const varData = await fetchVariabilityAnalysis(siteId);
            if (!varData) throw new Error("Variability data not found for this site.");

            const seas = varData.seasonal_variance;
            const contribution_seas = varData.seasonal_contribution_percent; // Data from Python JSON
            // Calculate Tide Seasonal Component : tide_seasonal = total_seasonal - ssh_seasonal - runup_seasonal
            const tideSeasonal = seas.total.map((total, i) => {
                const ssh = seas.ssh[i] || 0;
                const runup = seas.runup[i] || 0;
                const result = total - ssh - runup;
                // Plotly handles null/NaN data points gracefully.
                return isNaN(result) ? null : result;
            });

            plotData = [
                { x: seas.time, y: seas.total, mode: 'lines', name: 'TWL Seasonal', line: {color: 'black'} },
                { x: seas.time, y: seas.ssh, mode: 'lines', name: 'SSH Seasonal', line: {color: '#1f77b4',} },
                { x: seas.time, y: seas.runup, mode: 'lines', name: 'Runup Seasonal', line: {color: 'green'} },
                { x: seas.time, y: tideSeasonal, mode: 'lines', name: 'Tide Seasonal', line: {color: '#ff7f0e'} }
            ];

            layout = {
                title: `Component Seasonal Distribution - ${site.name}`,
                yaxis: { title: 'Water Level (m)' },
                height: 800,
                legend: { orientation: 'v', y: 1.1 }
            };
        }
        else if (graphType === 'variance_trend') {
            const varData = await fetchVariabilityAnalysis(siteId);
            if (!varData) throw new Error("Variability data not found for this site.");

            const tr = varData.trend_variance;
            const contribution_tr = varData.trend_contribution_percent; // Data from Python JSON
            // Calculate Tide trend Component 
            const tideTrend = tr.total.map((total, i) => {
                const ssh = tr.ssh[i] || 0;
                const runup = tr.runup[i] || 0;
                const result = total - ssh - runup;
                // Plotly handles null/NaN data points gracefully.
                return isNaN(result) ? null : result;
            });
            plotData = [
                { x: tr.time, y: tr.total, mode: 'lines', name: 'TWL Trend', line: {color: 'black'} },
                { x: tr.time, y: tr.ssh, mode: 'lines', name: 'SSH Trend', line: {color: '#1f77b4',} },
                { x: tr.time, y: tr.runup, mode: 'lines', name: 'Runup Trend', line: {color: 'green'} },
                { x: tr.time, y: tideTrend, mode: 'lines', name: 'Tide Trend', line: {color: '#ff7f0e'} }
            ];

            layout = {
                title: `Component Trend Distribution - ${site.name}`,
                yaxis: { title: 'Water Level (m)' },
                height: 800,
                legend: { orientation: 'v', y: 1.1 }
            };
        }
        // --- NEW BLOCKS END HERE ---
        /*
        else if (graphType === 'time_series') {
            // --- EVENT VARIABLE TIMESERIES (Line Chart) ---
            const data = await fetchEventTimeseriesData(siteId, eventId);
            
            plotData = [
                {
                    x: data.dates, y: data.twl,
                    mode: 'lines', name: 'Total Water Level (TWL)',
                    line: { color: '#e31a1c', width: 3 }
                },
                {
                    x: data.dates, y: data.tide,
                    mode: 'lines', name: 'Tide + SLA',
                    line: { color: '#1f78b4', dash: 'dash' }
                },
                {
                    x: data.dates, y: data.runup, // Added Runup based on R code
                    mode: 'lines', name: 'Wave Setup/Runup', 
                    line: { color: '#ff7f0e', dash: 'dot' } 
                },
                {
                    x: data.hours, y: data.hs,
                    mode: 'lines', name: 'Significant Wave Height (Hs)',
                    line: { color: '#33a02c', dash: 'dot' },
                    yaxis: 'y2' 
                }
            ];
            
            // Add Threshold Line
            plotData.push({
                x: data.hours,
                y: Array(data.hours.length).fill(site.threshold),
                mode: 'lines',
                name: 'Flood Threshold',
                line: { color: '#fdb462', dash: 'longdash' },
                showlegend: true
            });

            layout = {
                title: `Event Variable Timeseries for ${site.name} (Event: ${eventId})`,
                xaxis: { title: 'Hours from Event Start' },
                yaxis: { title: 'Water Level (m)', color: '#1f78b4' },
                yaxis2: {
                    title: 'Wave Height (m)',
                    overlaying: 'y',
                    side: 'right',
                    color: '#33a02c',
                    showgrid: false
                },
                legend: { x: 0, y: 1.15, orientation: 'h' },
                height: 800,
                margin: {t: 90, b: 70, l: 70, r: 70}
            };
        }
        */
        Plotly.newPlot(plotDiv, plotData, layout, {responsive: true, displayModeBar: true, modeBarButtonsToRemove: ['sendDataToCloud']});

    } catch (e) {
        console.error("Error rendering historical plot:", e);
        const errorMessage = e.message.includes("data available") ? e.message : "Failed to load/render plot data. Check console for details.";
        plotDiv.innerHTML = `<div class="p-5 text-center text-xl text-danger">Error: ${errorMessage}</div>`;
    }
}


// ====================================================================================
// INITIALIZATION 
// ====================================================================================

window.onload = function() {
    // 1. Initialize UI shell IMMEDIATELY (Map, date inputs)
    setupDateSelector(); 
    setupForecastHorizonSlider();
    initializeMap(); 
    renderRiskLegend();
    setupTabSwitching();
    setupHistoricalReactivity();

    document.getElementById('current-date-display').innerText = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    // 2. Start Asynchronous Data Fetching (populates markers, updates sidebar)
    fetchAndProcessAllSites(); 
    
};
