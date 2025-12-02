// =================================================================
// 1. CONFIGURATION ET VARIABLES
// =================================================================

// A. Fonds de carte
const basemaps = {
    "Dark Matter": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Plan Clair": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' })
};

// B. Initialisation Carte
const map = L.map('map', { 
    zoomControl: false,
    layers: [basemaps["Dark Matter"]] 
}).setView([48.5734, 7.7521], 12);

// C. Contrôles (Bas Gauche)
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.layers(basemaps, null, { position: 'bottomleft', collapsed: true }).addTo(map);

// D. Variables Globales
let rawData = { stops: null, lines: null };
let layers = { stops: null, lines: null };
let animationInterval = null;
let networkChart = null;

// E. Couleurs Lignes
const LINE_STYLES = {
    'A': '#E3001B', 'B': '#0099CC', 'C': '#F29400', 'D': '#007B3B', 
    'E': '#B36AE2', 'F': '#98BE16', 'G': '#FFCC00', 'H': '#800020', 
    'BUS': '#666666'
};

// =================================================================
// 2. CHARGEMENT DES DONNÉES
// =================================================================

function loadData() {
    console.log("Chargement Page 1...");
    Promise.all([
        fetch('../data/lignes_tram.geojson').then(r => r.json()),
        fetch('../data/lignes_bus.geojson').then(r => r.json()),
        fetch('../data/frequence_ems.geojson').then(r => r.json())
    ]).then(([tramLines, busLines, stopsData]) => {
        
        rawData.lines = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
        rawData.stops = stopsData;

        initLineSelector();
        initSearch();
        initPanel();
        initChart();
        initPlayer();
        
        updateVisualization();

        const loader = document.getElementById('loader');
        if(loader) { loader.style.opacity = 0; setTimeout(() => loader.remove(), 500); }

    }).catch(err => console.error("Erreur chargement :", err));
}

// =================================================================
// 3. MOTEUR GRAPHIQUE (CARTE)
// =================================================================

function getRadius(freq) { return (!freq) ? 0 : Math.max(2, Math.min(Math.sqrt(freq) * 2, 22)); }
function getColor(type) { return (type || "").toLowerCase().includes('tram') ? '#4cc9f0' : '#ff9f1c'; }

function getLineBadge(lineName) {
    const color = LINE_STYLES[lineName] || LINE_STYLES['BUS'];
    return `<span style="background-color: ${color}; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.8em; min-width: 18px; display: inline-block; text-align: center; margin-right: 5px;">${lineName}</span>`;
}

function updateVisualization() {
    const hour = parseInt(document.getElementById('time-slider').value);
    drawLines();
    drawStops(hour);
    updateChartHighlight(hour);
}

function drawLines() {
    if (layers.lines) map.removeLayer(layers.lines);
    const selectedLine = document.getElementById('line-select').value;
    const showTram = document.getElementById('toggle-tram').checked;
    const showBus = document.getElementById('toggle-bus').checked;

    layers.lines = L.geoJSON(rawData.lines, {
        style: f => ({
            color: f.properties.colour || '#fff',
            weight: (selectedLine === f.properties.ref) ? 4 : 2,
            opacity: (selectedLine === 'all' || selectedLine === f.properties.ref) ? 0.7 : 0.05
        }),
        filter: f => {
            const t = f.properties.route;
            if (t === 'tram' && !showTram) return false;
            if (t === 'bus' && !showBus) return false;
            return true;
        }
    }).addTo(map);
    layers.lines.bringToBack();
}

function drawStops(hour) {
    if (layers.stops) map.removeLayer(layers.stops);
    const selectedLine = document.getElementById('line-select').value;
    const showTram = document.getElementById('toggle-tram').checked;
    const showBus = document.getElementById('toggle-bus').checked;
    
    const propHour = 'h_' + hour;
    const propDetail = 'd_' + hour;

    layers.stops = L.geoJSON(rawData.stops, {
        filter: f => {
            const typeRaw = (f.properties.type || "").toLowerCase();
            const isTram = typeRaw.includes('tram');
            if (isTram && !showTram) return false;
            if (!isTram && !showBus) return false;
            if (selectedLine !== 'all') {
                const lines = (f.properties.liste_lignes || "").split(',').map(l => l.trim());
                if (!lines.includes(selectedLine)) return false;
            }
            return true;
        },
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
            radius: getRadius(f.properties[propHour]),
            fillColor: getColor(f.properties.type),
            color: "#fff", weight: 0.5, opacity: 0.9, fillOpacity: 0.8
        }),
        onEachFeature: (f, l) => {
            const accentColor = getColor(f.properties.type);
            const totalPassages = f.properties[propHour] || 0;
            const detailsRaw = f.properties[propDetail] || "";
            
            let linesText = f.properties.liste_lignes || "";
            let detailsHtml = "";

            if (detailsRaw && totalPassages > 0) {
                const items = detailsRaw.split(', ').map(item => {
                    const parts = item.split(':');
                    if (parts.length < 2) return "";
                    const ligne = parts[0];
                    const count = parts[1];
                    
                    return `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding:4px 0;">
                            <div>${getLineBadge(ligne)}</div>
                            <span style="font-size:0.85rem; color:#555;"><b>${count}</b> pass.</span>
                        </div>`;
                }).join('');
                
                detailsHtml = `<div id="details-${f.properties.nom.replace(/\W/g, '')}" style="display:none; margin-top:10px; background:#fff; padding:5px 8px; border-radius:4px; max-height:150px; overflow-y:auto; box-shadow:inset 0 0 5px rgba(0,0,0,0.05);">${items}</div>
                    <button onclick="togglePopupDetails(this)" style="width:100%; margin-top:8px; background:transparent; border:1px solid ${accentColor}; color:${accentColor}; border-radius:12px; padding:4px; cursor:pointer; font-size:0.75rem; transition:0.2s;">▼ Détails Fréquence</button>`;
            }

            l.bindPopup(`
                <div style="font-family: 'Montserrat', sans-serif; text-align: center; color: #333; min-width: 180px;">
                    <div style="font-size: 1.1rem; font-weight: 800; text-transform: uppercase; margin-bottom:5px;">${f.properties.nom}</div>
                    <div style="margin-bottom:10px; font-size:0.85rem; color:#666;">Lignes : <strong>${linesText}</strong></div>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
                    <div style="line-height: 1;">
                        <span style="font-size: 2.2rem; font-weight: 800; color: ${accentColor};">${totalPassages}</span>
                        <span style="font-size: 0.9rem; font-weight: 600; color: #666;">passages/h</span>
                    </div>
                    <div style="font-size: 0.8rem; color: #999; margin-top: 4px;">à ${hour}h00</div>
                    ${detailsHtml}
                </div>
            `);
        }
    }).addTo(map);
}

window.togglePopupDetails = function(btn) {
    const divDetails = btn.previousElementSibling;
    if (divDetails.style.display === "none") {
        divDetails.style.display = "block";
        btn.innerText = "▲ Masquer";
    } else {
        divDetails.style.display = "none";
        btn.innerText = "▼ Détails Fréquence";
    }
};

// =================================================================
// 4. FONCTIONS UX (RECHERCHE & ZEN)
// =================================================================

function initSearch() {
    const input = document.getElementById('stop-search');
    const resultsDiv = document.getElementById('search-results');

    if (!input || !rawData.stops) return;

    input.addEventListener('input', function(e) {
        const val = this.value.toLowerCase();
        resultsDiv.innerHTML = '';
        if (val.length < 2) { resultsDiv.style.display = 'none'; return; }

        const matches = rawData.stops.features.filter(f => 
            f.properties.nom.toLowerCase().includes(val)
        ).slice(0, 8);

        if (matches.length > 0) {
            resultsDiv.style.display = 'block';
            matches.forEach(f => {
                const div = document.createElement('div');
                div.className = 'result-item';
                div.innerHTML = `<span>${f.properties.nom}</span> <span class="result-type">${f.properties.type}</span>`;
                div.onclick = () => {
                    const [lng, lat] = f.geometry.coordinates;
                    map.flyTo([lat, lng], 16, { duration: 1.5 });
                    setTimeout(() => {
                        map.eachLayer(layer => {
                            if (layer.feature && layer.feature.properties.nom === f.properties.nom) {
                                layer.openPopup();
                            }
                        });
                    }, 1600);
                    input.value = f.properties.nom; resultsDiv.style.display = 'none';
                };
                resultsDiv.appendChild(div);
            });
        } else { resultsDiv.style.display = 'none'; }
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== resultsDiv) resultsDiv.style.display = 'none';
    });
}

// --- C'EST ICI LA FONCTION HARMONISÉE ---
function initPanel() {
    const btn = document.getElementById('toggle-panel');
    const panel = document.getElementById('controls');
    
    if(btn && panel) {
        btn.addEventListener('click', () => {
            panel.classList.toggle('panel-hidden');
            
            btn.classList.toggle('is-closed');

            if (panel.classList.contains('panel-hidden')) {
                btn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>'; 
            } else {
                btn.innerHTML = '✖';
            }
        });
    }
}

// =================================================================
// 5. GRAPHIQUE & PLAYER
// =================================================================

function initChart() {
    const ctx = document.getElementById('networkChart').getContext('2d');
    const heures = []; const totaux = [];

    for (let h = 5; h <= 23; h++) {
        heures.push(h + 'h');
        const prop = 'h_' + h;
        let sum = 0;
        if (rawData.stops) { rawData.stops.features.forEach(f => sum += (f.properties[prop] || 0)); }
        totaux.push(sum);
    }
    const valMax = Math.max(...totaux);

    networkChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: heures,
            datasets: [{
                label: 'Passages', data: totaux,
                borderColor: '#4cc9f0', backgroundColor: 'rgba(76, 201, 240, 0.1)',
                borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, title: { display: true, text: 'Charge du Réseau', color: '#aaa', font: {size:10} } },
            scales: {
                x: { display: true, ticks: { color: '#666', font: { size: 9 }, maxTicksLimit: 6 }, grid: { display: false } },
                y: { display: true, beginAtZero: true, suggestedMax: valMax * 1.1, ticks: { color: '#666', font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } }
            },
            animation: { duration: 0 }
        }
    });
}

function updateChartHighlight(hour) {
    if (!networkChart) return;
    const index = hour - 5;
    const pointColors = new Array(19).fill('transparent');
    const pointBorderColors = new Array(19).fill('transparent');
    const pointRadii = new Array(19).fill(0);
    
    if (index >= 0 && index < 19) {
        pointColors[index] = '#fff'; pointBorderColors[index] = '#4cc9f0'; pointRadii[index] = 6;
    }
    networkChart.data.datasets[0].pointBackgroundColor = pointColors;
    networkChart.data.datasets[0].pointBorderColor = pointBorderColors;
    networkChart.data.datasets[0].pointRadius = pointRadii;
    networkChart.update();
}

function initLineSelector() {
    const s = document.getElementById('line-select');
    s.innerHTML = '<option value="all">Toutes les lignes</option>';
    if (!rawData.lines) return;
    
    const linesList = []; const uniqueKeys = new Set();
    rawData.lines.features.forEach(f => {
        const ref = f.properties.ref || f.properties.name; 
        const type = f.properties.route || "bus"; 
        const key = type + "-" + ref;
        if (ref && !uniqueKeys.has(key)) {
            uniqueKeys.add(key);
            linesList.push({ ref: ref, label: `${type==='tram'?'Tram':'Bus'} ${ref}`, type: type });
        }
    });
    linesList.sort((a, b) => (a.type !== b.type) ? (a.type==='tram'?-1:1) : a.ref.localeCompare(b.ref, undefined, {numeric:true}));
    linesList.forEach(l => { const o = document.createElement('option'); o.value = l.ref; o.innerText = l.label; s.appendChild(o); });
    s.addEventListener('change', updateVisualization);
}

function initPlayer() {
    const btn = document.getElementById('play-btn');
    const slider = document.getElementById('time-slider');
    const display = document.getElementById('current-time-display');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
            btn.textContent = "▶";
            btn.classList.remove('paused');
        } else {
            btn.textContent = "⏸";
            btn.classList.add('paused');
            animationInterval = setInterval(() => {
                let val = parseInt(slider.value);
                if (val >= 23) val = 4;
                slider.value = val + 1;
                display.innerText = (slider.value < 10 ? '0'+slider.value : slider.value) + 'h00';
                updateVisualization();
            }, 1000);
        }
    });

    slider.addEventListener('input', () => {
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
            btn.textContent = "▶";
            btn.classList.remove('paused');
        }
        const h = parseInt(slider.value);
        display.innerText = (h < 10 ? '0'+h : h) + 'h00';
        updateVisualization();
    });
}

document.getElementById('toggle-tram').addEventListener('change', updateVisualization);
document.getElementById('toggle-bus').addEventListener('change', updateVisualization);

// =================================================================
// 6. GESTION DES MODALS (INFO & AIDE)
// =================================================================

function setupModal(modalId, btnId) {
    const modal = document.getElementById(modalId);
    const btn = document.getElementById(btnId);
    const closeBtn = modal ? modal.querySelector('.close-btn') : null;

    if (btn && modal) {
        btn.onclick = (e) => { e.preventDefault(); modal.style.display = "block"; };
        if (closeBtn) closeBtn.onclick = () => modal.style.display = "none";
        window.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = "none"; });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupModal("modal-info", "info-btn");
    setupModal("modal-help", "help-btn");
    loadData();

    const FILTER_IDS = ['toggle-tram', 'toggle-bus'];

    function findFilterVisual(id) {
        let el = document.querySelector(`label[for="${id}"]`) || document.getElementById(id + '-btn') || document.getElementById(id);
        if (el && el.tagName && el.tagName.toLowerCase() === 'input') {
            el = el.parentElement || el;
        }
        return el;
    }

    function updateFilterButtonVisual(id) {
        const cb = document.getElementById(id);
        const vis = findFilterVisual(id);
        if (!vis || !cb) return;
        if (!cb.checked) {
            vis.style.opacity = '0.5';
            vis.style.filter = 'grayscale(100%)';
            vis.style.borderColor = '#aaa';
            vis.style.color = '#777';
        } else {
            vis.style.opacity = '';
            vis.style.filter = '';
            vis.style.borderColor = '';
            vis.style.color = '';
        }
    }

    FILTER_IDS.forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        cb.addEventListener('change', (e) => {
            updateFilterButtonVisual(id);
            updateVisualization();
        });
        updateFilterButtonVisual(id);
    });

});
