/* =================================================================
   PAGE ACCESSIBILITÉ - LOGIQUE SPÉCIFIQUE (CORRIGÉE : BUFFER ARRÊTS)
   ================================================================= */

// 1. INIT & CONFIG
const map = initMap('map');

// Création des "Panes" (Calques Z-Index)
map.createPane('zBackground'); map.getPane('zBackground').style.zIndex = 200;
map.createPane('zBuffers'); map.getPane('zBuffers').style.zIndex = 350;
map.createPane('zTop'); map.getPane('zTop').style.zIndex = 650;

// Variables Globales
// Ajout de 'stops' pour stocker les arrêts
let data = { lines: null, pois: null, stats: null, stops: null };
let state = { currentLineKey: null, timeFilter: 'all' };
let layers = {
    background: L.layerGroup().addTo(map),
    currentLine: null,
    buffers: L.layerGroup().addTo(map), 
    pois: L.layerGroup().addTo(map)     
};
let accessChart = null;

// Couleurs spécifiques aux catégories
const CAT_COLORS = { 
    "Santé": "#ff4757", 
    "Éducation": "#2ed573", 
    "Commerces": "#ffa502", 
    "Loisirs": "#70a1ff", 
    "Autre": "#a4b0be" 
};

// 2. CHARGEMENT DES DONNÉES
function loadData() {
    console.log("Chargement Données Accessibilité...");
    
    const charger = (url) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(url));

    Promise.all([
        charger('../data/lignes_tram.geojson'),
        charger('../data/lignes_bus.geojson'),
        fetch('../data/equipements_ids.geojson').then(r => r.ok ? r.json() : charger('../data/equipements.geojson')),
        charger('../data/stats_accessibilite.json'),
        charger('../data/frequence_ems.geojson') // <--- NOUVEAU : Chargement des arrêts
    ]).then(([tramLines, busLines, poisData, statsData, stopsData]) => {

        data.lines = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
        data.pois = poisData;
        data.stats = statsData;
        data.stops = stopsData; // <--- Stockage des arrêts

        initLineSelector();
        initChart();
        initFiltersEvents();
        updatePoisDisplay();
        
        initGlobalUI();

    }).catch(err => {
        console.error("Erreur chargement :", err);
        alert("Impossible de charger les données d'analyse.");
    });
}

// 3. LOGIQUE CARTE

// --- NOUVELLE FONCTION UTILITAIRE ---
// Récupère les arrêts de la ligne active (ex: "Tram A" -> cherche "a" dans les propriétés)
function getStopsForCurrentLine() {
    if (!state.currentLineKey || !data.stops) return [];

    // Format attendu de currentLineKey : "Tram A" ou "Bus 10"
    const parts = state.currentLineKey.split(' ');
    const ref = parts[1] ? parts[1].toLowerCase() : "";

    return data.stops.features.filter(f => {
        const lignes = (f.properties.liste_lignes || "").toLowerCase();
        // On découpe par virgule pour éviter les confusions (ex: ligne 1 vs 10)
        const lignesArray = lignes.split(',').map(s => s.trim());
        return lignesArray.includes(ref);
    });
}

function selectLine(lineKey) {
    state.currentLineKey = lineKey;

    // Reset visuel
    if (layers.currentLine) map.removeLayer(layers.currentLine);
    layers.buffers.clearLayers();
    document.getElementById('line-length').innerText = "-";

    if (!lineKey) return;

    // Récupération de la géométrie de la ligne (Tracé)
    const [targetType, targetRef] = lineKey.split(' '); 
    const segments = data.lines.features.filter(f => {
        const fRef = f.properties.ref || f.properties.name;
        const fType = (f.properties.route || "").toLowerCase().includes('tram') ? 'Tram' : 'Bus';
        return fRef == targetRef && fType == targetType;
    });

    // Affichage de la ligne sélectionnée (Le tracé reste utile pour la compréhension)
    if (segments.length > 0) {
        layers.currentLine = L.geoJSON({type: "FeatureCollection", features: segments}, {
            style: { color: "#fff", weight: 5, opacity: 1, shadowBlur:10 }
        }).addTo(map);
        
        map.flyToBounds(layers.currentLine.getBounds(), { padding: [50, 50], duration: 1.2, easeLinearity: 0.25 });

        // Calcul longueur approximative
        let totalMeters = 0;
        layers.currentLine.eachLayer(layer => {
            if (layer.getLatLngs) {
                const latlngs = layer.getLatLngs();
                const parts = Array.isArray(latlngs[0]) ? latlngs : [latlngs];
                parts.forEach(part => {
                    for(let i=0; i<part.length-1; i++) totalMeters += part[i].distanceTo(part[i+1]);
                });
            }
        });
        document.getElementById('line-length').innerText = `${(totalMeters / 1000 / 2).toFixed(1)} km`;
    }

    drawBuffers(); // Appel de la nouvelle fonction de dessin
    updatePoisDisplay();
    updateChart();
}

// --- FONCTION MODIFIÉE : BUFFERS AUTOUR DES ARRÊTS ---
function drawBuffers() {
    layers.buffers.clearLayers();
    if (!state.currentLineKey) return;

    // 1. Récupérer les arrêts concernés
    const lineStops = getStopsForCurrentLine();

    // 2. Configuration des rayons (Vitesse ~4.8km/h => 80m/min)
    const configs = [
        { key: '10_min', radius: 800, color: '#444', opacity: 0.15 },
        { key: '5_min',  radius: 400, color: '#666', opacity: 0.25 },
        { key: '1_min',  radius: 80,  color: '#4cc9f0', opacity: 0.4 }
    ];

    // 3. Filtrer selon le bouton actif (ou 'all')
    // On dessine du plus grand au plus petit pour la superposition
    const activeConfigs = (state.timeFilter === 'all') 
        ? configs 
        : configs.filter(c => c.key === state.timeFilter);

    // 4. Dessiner les cercles
    activeConfigs.forEach(conf => {
        lineStops.forEach(stop => {
            // Leaflet utilise [lat, lng], GeoJSON utilise [lng, lat]
            const latlng = [stop.geometry.coordinates[1], stop.geometry.coordinates[0]];
            
            L.circle(latlng, {
                pane: 'zBuffers',       // Z-index intermédiaire
                radius: conf.radius,    // Mètres
                color: 'transparent',   // Pas de bordure
                fillColor: conf.color,
                fillOpacity: conf.opacity,
                interactive: false      // Ne pas bloquer les clics
            }).addTo(layers.buffers);
        });
    });
}

// 4. LOGIQUE POIS (POINTS D'INTÉRÊT)
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

    // Filtrage des IDs valides selon le temps choisi
    let validIds = new Set();
    if (state.timeFilter === 'all') {
        if(stats.all_ids) stats.all_ids.forEach(id => validIds.add(id));
        else ['1_min', '5_min', '10_min'].forEach(t => { 
            if(stats.buffers[t]?.ids) stats.buffers[t].ids.forEach(id => validIds.add(id)); 
        });
    } else {
        const ids = stats.buffers[state.timeFilter]?.ids || [];
        ids.forEach(id => validIds.add(id));
    }

    // Affichage des points
    L.geoJSON(data.pois, {
        filter: f => {
            if (!filters[f.properties.categorie]) return false;
            if (!f.properties.id_unique) return true;
            return validIds.has(f.properties.id_unique);
        },
        pointToLayer: (feature, latlng) => {
            const cat = feature.properties.categorie;
            return L.circleMarker(latlng, {
                pane: 'zTop', // Au dessus de tout
                radius: 4, 
                fillColor: CAT_COLORS[cat], color: CAT_COLORS[cat],
                weight: 1, fillOpacity: 0.9, opacity: 1          
            });
        },
        onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.nom}</strong><br><small>${f.properties.categorie}</small>`)
    }).addTo(layers.pois);
}

// 5. GRAPHIQUE & CONTROLES
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

// 6. INITIALISATION DES ÉVÉNEMENTS
function initLineSelector() {
    const s = document.getElementById('line-select');
    if(!data.stats) return;
    Object.keys(data.stats).sort().forEach(k => {
        const o = document.createElement('option'); o.value = k; o.innerText = k; s.appendChild(o);
    });
    s.addEventListener('change', (e) => selectLine(e.target.value));
}

function initFiltersEvents() {
    // A. Boutons de temps
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.timeFilter = e.target.dataset.time;
            drawBuffers();
            updatePoisDisplay();
            updateChart();
        });
    });

    // B. Checkbox Réseau Global
    const toggleNet = document.getElementById('toggle-network');
    if (toggleNet && data.lines) {
        toggleNet.addEventListener('change', () => {
            layers.background.clearLayers();
            if (toggleNet.checked) {
                L.geoJSON(data.lines, {
                    style: f => {
                        const type = f.properties.route;
                        if (type === 'tram') return { color: "#4cc9f0", weight: 2, opacity: 0.3 };
                        return { color: "#ff9f1c", weight: 1, opacity: 0.3, dashArray: '3, 6' };
                    },
                    pane: 'zBackground', interactive: false 
                }).addTo(layers.background);
            }
        });
    }

    // C. Filtres Catégories
    ['toggle-sante', 'toggle-education', 'toggle-commerces', 'toggle-loisirs'].forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        const updateVisual = () => {
            let el = cb.parentElement;
            if (!cb.checked) {
                el.style.opacity = '0.5'; el.style.filter = 'grayscale(100%)';
            } else {
                el.style.opacity = ''; el.style.filter = '';
            }
        };
        cb.addEventListener('change', () => { updateVisual(); updatePoisDisplay(); });
        updateVisual();
    });
}

function initChart() { updateChart(); }

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

document.addEventListener('DOMContentLoaded', loadData);