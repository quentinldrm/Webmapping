/* =================================================================
   PAGE ACCESSIBILITÉ - LOGIQUE SPATIALE CORRIGÉE
   ================================================================= */

// 1. INIT & CONFIG
const map = initMap('map');

// Création des "Panes"
map.createPane('zBackground'); map.getPane('zBackground').style.zIndex = 200;
map.createPane('zBuffers'); map.getPane('zBuffers').style.zIndex = 350;
map.createPane('zTop'); map.getPane('zTop').style.zIndex = 650;

let data = { lines: null, pois: null, stats: null, stops: null };

// CHANGEMENT ICI : Par défaut sur 5 minutes
let state = { currentLineKey: null, timeFilter: '5_min' }; 

let layers = {
    background: L.layerGroup().addTo(map),
    currentLine: null,
    buffers: L.layerGroup().addTo(map), 
    pois: L.layerGroup().addTo(map)     
};
let accessChart = null;

// Configuration des Rayons (Mètres) et Couleurs
const BUFFER_CONFIG = {
    '1_min':  { radius: 80,  color: '#4cc9f0', label: '1 min' },
    '5_min':  { radius: 400, color: '#666',    label: '5 min' },
    '10_min': { radius: 800, color: '#444',    label: '10 min' }
};

const CAT_COLORS = { 
    "Santé": "#ff4757", "Éducation": "#2ed573", 
    "Commerces": "#ffa502", "Loisirs": "#70a1ff", "Autre": "#a4b0be" 
};

// 2. CHARGEMENT
function loadData() {
    console.log("Chargement Données...");
    const charger = (url) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(url));

    Promise.all([
        charger('../data/lignes_tram.geojson'),
        charger('../data/lignes_bus.geojson'),
        fetch('../data/equipements_ids.geojson').then(r => r.ok ? r.json() : charger('../data/equipements.geojson')),
        charger('../data/stats_accessibilite.json'),
        charger('../data/frequence_ems.geojson')
    ]).then(([tramLines, busLines, poisData, statsData, stopsData]) => {

        data.lines = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
        data.pois = poisData;
        data.stats = statsData;
        data.stops = stopsData;

        initLineSelector();
        initChart();
        initFiltersEvents();
        initGlobalUI();

    }).catch(err => console.error("Erreur:", err));
}

// 3. LOGIQUE MÉTIER

function getStopsForCurrentLine() {
    if (!state.currentLineKey || !data.stops) return [];
    const parts = state.currentLineKey.split(' ');
    const ref = parts[1] ? parts[1].toLowerCase() : "";
    return data.stops.features.filter(f => {
        const lignes = (f.properties.liste_lignes || "").toLowerCase();
        return lignes.split(',').map(s => s.trim()).includes(ref);
    });
}

// Vérifie si un point (lat, lng) est à l'intérieur d'un des cercles de rayon donné
function isPointInBuffers(lat, lng, stops, radiusMeters) {
    const pointLatLng = L.latLng(lat, lng);
    return stops.some(stop => {
        const stopLatLng = L.latLng(stop.geometry.coordinates[1], stop.geometry.coordinates[0]);
        return pointLatLng.distanceTo(stopLatLng) <= radiusMeters;
    });
}

function selectLine(lineKey) {
    state.currentLineKey = lineKey;
    if (layers.currentLine) map.removeLayer(layers.currentLine);
    layers.buffers.clearLayers();
    document.getElementById('line-length').innerText = "-";

    if (!lineKey) return;

    // A. TRACÉ DE LA LIGNE
    const [targetType, targetRef] = lineKey.split(' '); 
    const segments = data.lines.features.filter(f => {
        const fRef = f.properties.ref || f.properties.name;
        const fType = (f.properties.route || "").toLowerCase().includes('tram') ? 'Tram' : 'Bus';
        return fRef == targetRef && fType == targetType;
    });

    if (segments.length > 0) {
        layers.currentLine = L.geoJSON({type: "FeatureCollection", features: segments}, {
            style: { color: "#fff", weight: 4, opacity: 0.8, dashArray: '1, 6' }
        }).addTo(map);
        map.flyToBounds(layers.currentLine.getBounds(), { padding: [50, 50], duration: 1.0 });

        // Calcul longueur
        let totalMeters = 0;
        layers.currentLine.eachLayer(layer => {
            if (layer.getLatLngs) {
                const parts = Array.isArray(layer.getLatLngs()[0]) ? layer.getLatLngs() : [layer.getLatLngs()];
                parts.forEach(part => { for(let i=0; i<part.length-1; i++) totalMeters += part[i].distanceTo(part[i+1]); });
            }
        });
        document.getElementById('line-length').innerText = `${(totalMeters / 1000 / 2).toFixed(1)} km`;
    }

    // B. DESSIN DES BUFFERS
    drawBuffers();
    
    // C. ANALYSE SPATIALE & UI
    refreshAnalysis();
}

function drawBuffers() {
    layers.buffers.clearLayers();
    if (!state.currentLineKey) return;

    const lineStops = getStopsForCurrentLine();
    
    // Récupération de la config selon le filtre actuel (plus de cas 'all')
    const conf = BUFFER_CONFIG[state.timeFilter];

    if (conf) {
        lineStops.forEach(stop => {
            const latlng = [stop.geometry.coordinates[1], stop.geometry.coordinates[0]];
            
            L.circle(latlng, {
                pane: 'zBuffers',
                radius: conf.radius,
                color: conf.color,       
                weight: 1,               
                fillColor: conf.color,
                fillOpacity: 0.08,       
                interactive: false
            }).addTo(layers.buffers);
        });
    }
}

// Cette fonction filtre les POIs et recalcule les stats en temps réel
function refreshAnalysis() {
    layers.pois.clearLayers();
    if (!state.currentLineKey) return;

    const lineStops = getStopsForCurrentLine();
    
    const catFilters = {
        "Santé": document.getElementById('toggle-sante')?.checked,
        "Éducation": document.getElementById('toggle-education')?.checked,
        "Commerces": document.getElementById('toggle-commerces')?.checked,
        "Loisirs": document.getElementById('toggle-loisirs')?.checked
    };

    // Définition du rayon max (plus besoin de logique complexe pour 'all')
    const maxRadius = BUFFER_CONFIG[state.timeFilter].radius;

    // --- CALCUL DES STATS EN TEMPS RÉEL ---
    let realTimeCounts = { "Santé": 0, "Éducation": 0, "Commerces": 0, "Loisirs": 0 };
    let filteredPois = [];

    data.pois.features.forEach(f => {
        const cat = f.properties.categorie;
        
        // 1. Filtre Catégorie
        if (!catFilters[cat]) return;

        // 2. Filtre Spatial
        const isNear = isPointInBuffers(f.geometry.coordinates[1], f.geometry.coordinates[0], lineStops, maxRadius);
        
        if (isNear) {
            filteredPois.push(f);
            if (realTimeCounts[cat] !== undefined) realTimeCounts[cat]++;
        }
    });

    // --- MISE À JOUR CARTE ---
    L.geoJSON({ type: "FeatureCollection", features: filteredPois }, {
        pointToLayer: (feature, latlng) => {
            const cat = feature.properties.categorie;
            return L.circleMarker(latlng, {
                pane: 'zTop',
                stroke : false,
                radius: 4, 
                fillColor: CAT_COLORS[cat], color: "#fff", weight: 1, 
                fillOpacity: 1, opacity: 1          
            });
        },
        onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.nom}</strong><br><small>${f.properties.categorie}</small>`)
    }).addTo(layers.pois);

    // --- MISE À JOUR GRAPHIQUE ---
    updateChart(realTimeCounts);
}


// 4. GRAPHIQUE & UI

function updateChart(counts) {
    const ctx = document.getElementById('accessChart').getContext('2d');
    if (accessChart) { accessChart.destroy(); accessChart = null; }

    let totalScore = 0;
    
    if (!counts) counts = { "Santé": 0, "Éducation": 0, "Commerces": 0, "Loisirs": 0 };

    const cats = ["Santé", "Éducation", "Commerces", "Loisirs"];
    const values = cats.map(c => counts[c]);
    totalScore = values.reduce((a, b) => a + b, 0);

    const scoreEl = document.getElementById('total-score');
    if(scoreEl) scoreEl.innerText = state.currentLineKey ? totalScore : "-";

    accessChart = new Chart(ctx, {
        type: 'bar',
        data: { 
            labels: cats, 
            datasets: [{
                label: 'Services accessibles',
                data: values,
                backgroundColor: cats.map(c => CAT_COLORS[c]),
                borderRadius: 4,
                borderWidth: 0
            }] 
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                // Titre simplifié
                title: { display: true, text: `Services (${state.timeFilter.replace('_',' ')})`, color: '#aaa' },
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: '#ddd', font: {size: 10} }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: '#ddd' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            },
            animation: { duration: 400 }
        }
    });
}

function initLineSelector() {
    const s = document.getElementById('line-select');
    if(!data.stats) return;

    Object.keys(data.stats)
        .filter(k => !k.includes('FlexHop') && !k.includes('Taxibus'))
        .sort((a,b) => a.localeCompare(b, undefined, {numeric: true}))
        .forEach(k => {
            const o = document.createElement('option'); 
            o.value = k; 
            o.innerText = k; 
            s.appendChild(o);
        });

    s.addEventListener('change', (e) => selectLine(e.target.value));
}

function initFiltersEvents() {
    const timeBtns = document.querySelectorAll('.time-btn');

    // 1. Initialisation visuelle : activer le bouton par défaut (5_min)
    timeBtns.forEach(btn => {
        if (btn.dataset.time === state.timeFilter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 2. Gestion du clic
    timeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Mise à jour visuelle
            timeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Mise à jour logique
            state.timeFilter = e.target.dataset.time;
            
            // Recalcul
            drawBuffers();
            refreshAnalysis();
        });
    });

    // Checkbox Catégories
    ['toggle-sante', 'toggle-education', 'toggle-commerces', 'toggle-loisirs'].forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        const updateVisual = () => {
            let el = cb.parentElement;
            if (!cb.checked) { el.style.opacity = '0.5'; el.style.filter = 'grayscale(100%)'; } 
            else { el.style.opacity = ''; el.style.filter = ''; }
        };
        cb.addEventListener('change', () => { updateVisual(); refreshAnalysis(); });
        updateVisual();
    });
    
    // Checkbox Réseau Global
    const toggleNet = document.getElementById('toggle-network');
    if (toggleNet) {
        toggleNet.addEventListener('change', () => {
            layers.background.clearLayers();
            if (toggleNet.checked && data.lines) {
                L.geoJSON(data.lines, {
                    style: f => ({ 
                        color: f.properties.route==='tram'?"#4cc9f0":"#ff9f1c", 
                        weight: 1, opacity: 0.2, dashArray: '2, 5' 
                    }),
                    pane: 'zBackground', interactive: false 
                }).addTo(layers.background);
            }
        });
    }
}

// GESTION DU POP-UP DE BIENVENUE
function showWelcomePopup() {
    const modalId = 'welcome-modal';
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'block';
    const closeBtn = modal.querySelector('.close-btn');

    const closeModal = () => { modal.style.display = 'none'; };

    if (closeBtn) closeBtn.onclick = closeModal;
    window.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
}

function initChart() { updateChart(null); }

document.addEventListener('DOMContentLoaded', loadData);
