// =================================================================
// 1. CONFIGURATION
// =================================================================

// Fonds de carte
const basemaps = {
    "Dark Matter": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Plan Clair": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' })
};

// Initialisation de la carte
const map = L.map('map', { 
    zoomControl: false,
    preferCanvas: true,
    layers: [basemaps["Dark Matter"]]
}).setView([48.5734, 7.7521], 12);

// Contrôles
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.control.layers(basemaps, null, { position: 'bottomleft', collapsed: true }).addTo(map);

// Panes Z-Index
map.createPane('zBackground'); map.getPane('zBackground').style.zIndex = 200;
map.createPane('zBuffers'); map.getPane('zBuffers').style.zIndex = 350;
map.createPane('zTop'); map.getPane('zTop').style.zIndex = 650;

// Variables
let data = { lines: null, pois: null, stats: null };
let state = { currentLineKey: null, timeFilter: 'all' };
let layers = {
    background: L.layerGroup().addTo(map),
    currentLine: null,
    buffers: L.layerGroup().addTo(map), 
    pois: L.layerGroup().addTo(map)     
};
let accessChart = null;

// Catégories
const CAT_COLORS = { "Santé": "#ff4757", "Éducation": "#2ed573", "Commerces": "#ffa502", "Loisirs": "#70a1ff", "Autre": "#a4b0be" };
const ICONS = { "Santé": "fa-heart-pulse", "Éducation": "fa-graduation-cap", "Commerces": "fa-cart-shopping", "Loisirs": "fa-ticket", "Autre": "fa-map-pin" };

// =================================================================
// 2. CHARGEMENT
// =================================================================

const charger = (nom) => fetch(nom).then(r => r.ok ? r.json() : Promise.reject(nom));

Promise.all([
    charger('lignes_tram.geojson'),
    charger('lignes_bus.geojson'),
    fetch('equipements_ids.geojson').then(r => r.ok ? r.json() : charger('equipements.geojson')),
    charger('stats_accessibilite.json')
]).then(([tramLines, busLines, poisData, statsData]) => {

    data.lines = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
    data.pois = poisData;
    data.stats = statsData;

    try {
        initLineSelector();
        initChart();
        updatePoisDisplay();
        
        initPanel();

        const loader = document.getElementById('loader');
        if(loader) {
            loader.style.opacity = 0;
            setTimeout(() => loader.remove(), 500);
        }
    } catch (e) { console.error(e); }

}).catch(err => alert("Erreur chargement : " + err));

// =================================================================
// 3. FONCTIONS CARTE
// =================================================================

function selectLine(lineKey) {
    state.currentLineKey = lineKey;

    if (layers.currentLine) map.removeLayer(layers.currentLine);
    layers.buffers.clearLayers();
    document.getElementById('line-length').innerText = "-";

    if (!lineKey) return;

    const [targetType, targetRef] = lineKey.split(' '); 
    const segments = data.lines.features.filter(f => {
        const fRef = f.properties.ref || f.properties.name;
        const fType = (f.properties.route || "").toLowerCase().includes('tram') ? 'Tram' : 'Bus';
        return fRef == targetRef && fType == targetType;
    });

    if (segments.length > 0) {
        layers.currentLine = L.geoJSON({type: "FeatureCollection", features: segments}, {
            style: { color: "#fff", weight: 5, opacity: 1, shadowBlur:10 }
        }).addTo(map);
        
        map.flyToBounds(layers.currentLine.getBounds(), { padding: [50, 50], duration: 1.2, easeLinearity: 0.25 });

        let totalMeters = 0;
        layers.currentLine.eachLayer(layer => {
            if (layer.getLatLngs) {
                const latlngs = layer.getLatLngs();
                if (Array.isArray(latlngs[0])) {
                    latlngs.forEach(part => {
                        for(let i=0; i<part.length-1; i++) totalMeters += part[i].distanceTo(part[i+1]);
                    });
                } else {
                    for(let i=0; i<latlngs.length-1; i++) totalMeters += latlngs[i].distanceTo(latlngs[i+1]);
                }
            }
        });
        const km = (totalMeters / 1000 / 2).toFixed(1);
        document.getElementById('line-length').innerText = `${km} km`;
    }

    drawBuffers();
    updatePoisDisplay();
    updateChart();
}

window.toggleNetwork = function() {
    const isChecked = document.getElementById('toggle-network').checked;
    layers.background.clearLayers();
    if (isChecked) {
        L.geoJSON(data.lines, {
            style: { color: "#888", weight: 1, opacity: 0.3, dashArray: '3, 6' },
            pane: 'zBackground', interactive: false 
        }).addTo(layers.background);
    }
};

function updatePoisDisplay() {
    layers.pois.clearLayers();
    if (!state.currentLineKey) return;

    const filters = {
        "Santé": document.getElementById('toggle-sante')?.checked,
        "Éducation": document.getElementById('toggle-education')?.checked,
        "Commerces": document.getElementById('toggle-commerces')?.checked,
        "Loisirs": document.getElementById('toggle-loisirs')?.checked
    };

    const stats = data.stats[state.currentLineKey];
    if (!stats) return;

    let validIds = new Set();
    if (state.timeFilter === 'all') {
        if(stats.all_ids) stats.all_ids.forEach(id => validIds.add(id));
        else ['1_min', '5_min', '10_min'].forEach(t => { if(stats.buffers[t]?.ids) stats.buffers[t].ids.forEach(id => validIds.add(id)); });
    } else {
        const ids = stats.buffers[state.timeFilter]?.ids || [];
        ids.forEach(id => validIds.add(id));
    }

    L.geoJSON(data.pois, {
        filter: f => {
            if (!filters[f.properties.categorie]) return false;
            if (!f.properties.id_unique) return true;
            return validIds.has(f.properties.id_unique);
        },
        pointToLayer: (feature, latlng) => {
            const cat = feature.properties.categorie;
            return L.circleMarker(latlng, {
                pane: 'zTop', radius: 4, fillColor: CAT_COLORS[cat], color: CAT_COLORS[cat],
                weight: 1, fillOpacity: 0.9, opacity: 1          
            });
        },
        onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.nom}</strong><br><small>${f.properties.categorie}</small>`)
    }).addTo(layers.pois);
}

function drawBuffers() {
    layers.buffers.clearLayers();
    if (!state.currentLineKey || !data.stats[state.currentLineKey]) return;

    const stats = data.stats[state.currentLineKey];
    const steps = [
        { key: '10_min', color: '#444', opacity: 0.4 },
        { key: '5_min',  color: '#666', opacity: 0.5 },
        { key: '1_min',  color: '#4cc9f0', opacity: 0.3 }
    ];

    steps.forEach(step => {
        if (state.timeFilter !== 'all' && state.timeFilter !== step.key) return;
        const bufferData = stats.buffers[step.key];
        if (bufferData && bufferData.geometry) {
            L.geoJSON(bufferData.geometry, {
                pane: 'zBuffers', renderer: L.svg({ pane: 'zBuffers' }), 
                style: { fillColor: step.color, fillOpacity: step.opacity, weight: 1, color: step.color, dashArray: '4,4' }
            }).addTo(layers.buffers);
        }
    });
}

// =================================================================
// 4. GRAPHIQUE & INTERFACE
// =================================================================

function updateChart() {
    const ctx = document.getElementById('accessChart').getContext('2d');
    if (accessChart) { accessChart.destroy(); accessChart = null; }

    let labels = [], datasets = [], titleText = "Sélectionnez une ligne", totalScore = 0;

    if (state.currentLineKey && data.stats[state.currentLineKey]) {
        const stats = data.stats[state.currentLineKey];
        const cats = ["Santé", "Éducation", "Commerces", "Loisirs"];
        
        if (state.timeFilter === 'all') {
            labels = ['1 min', '5 min', '10 min'];
            titleText = `Services (Global)`;
            datasets = cats.map(cat => ({
                label: cat,
                data: [
                    stats.buffers['1_min']?.counts[cat] || 0,
                    stats.buffers['5_min']?.counts[cat] || 0,
                    stats.buffers['10_min']?.counts[cat] || 0
                ],
                backgroundColor: CAT_COLORS[cat],
                borderRadius: 4
            }));
        } else {
            labels = cats;
            const niceLabels = {'1_min': '1 min', '5_min': '5 min', '10_min': '10 min'};
            titleText = `Services à ${niceLabels[state.timeFilter]}`;
            const counts = stats.buffers[state.timeFilter]?.counts || {};
            datasets = [{
                label: 'Nombre',
                data: cats.map(c => counts[c] || 0),
                backgroundColor: cats.map(c => CAT_COLORS[c]),
                borderRadius: 6
            }];
        }

        datasets.forEach(d => { totalScore += d.data.reduce((a, b) => a + b, 0); });
    }

    const scoreEl = document.getElementById('total-score');
    if(scoreEl) {
        scoreEl.innerText = state.currentLineKey ? totalScore : "-";
        scoreEl.style.color = '#fff';
    }

    accessChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: titleText, color: '#fff' },
                legend: { position: 'bottom', labels: { color: '#aaa', boxWidth: 10 }, display: (state.timeFilter === 'all') }
            },
            scales: {
                x: { ticks: { color: '#ddd' }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: '#ddd', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.1)' } }
            },
            animation: { duration: 300 }
        }
    });
}

window.setChartFilter = function(val) {
    state.timeFilter = val;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    drawBuffers();
    updatePoisDisplay();
    updateChart();
};

window.togglePoiLayer = updatePoisDisplay;

function initLineSelector() {
    const s = document.getElementById('line-select');
    if(!data.stats) return;
    Object.keys(data.stats).sort().forEach(k => {
        const o = document.createElement('option'); o.value = k; o.innerText = k; s.appendChild(o);
    });
    s.addEventListener('change', (e) => selectLine(e.target.value));
}

function initChart() { updateChart(); }

// =================================================================
// 5. BOUTONS ET MODALS (CORRIGÉS)
// =================================================================

function initPanel() {
    const btn = document.getElementById('toggle-panel');
    const panel = document.getElementById('controls');
    
    if(btn && panel) {
        btn.addEventListener('click', () => {
            panel.classList.toggle('panel-hidden');
            
            btn.classList.toggle('is-closed');

            if (panel.classList.contains('panel-hidden')) {
                btn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>'; 
                btn.title = "Ouvrir les réglages";
            } else {
                btn.innerHTML = '✖';
                btn.title = "Mode Zen (Cacher)";
            }
        });
    }
}

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

    // --- Ajout: gestion visuelle des boutons/labels des filtres de catégories ---
    const FILTER_IDS = ['toggle-sante', 'toggle-education', 'toggle-commerces', 'toggle-loisirs'];

    function findFilterVisual(id) {
        // Cherche d'abord un label[for="id"], puis un élément id-btn, sinon la checkbox elle-même ou son parent
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
            updatePoisDisplay(); // rafraîchir l'affichage
        });
        // état initial
        updateFilterButtonVisual(id);
    });
    // --- Fin ajout ---
});