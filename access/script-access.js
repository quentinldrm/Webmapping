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
let state = { currentLineKey: null, timeFilter: 'all' }; // 'all', '1_min', '5_min', '10_min'
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
    // Optimisation : On pourrait utiliser un index spatial (ex: RBush) pour plus de perf,
    // mais pour < 100 arrêts, la boucle simple suffit.
    const pointLatLng = L.latLng(lat, lng);
    
    // On cherche SI IL EXISTE au moins un arrêt à distance < rayon
    return stops.some(stop => {
        // Leaflet GeoJSON est [lng, lat], L.latLng attend (lat, lng)
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

    // A. TRACÉ DE LA LIGNE (Visuel seulement)
    const [targetType, targetRef] = lineKey.split(' '); 
    const segments = data.lines.features.filter(f => {
        const fRef = f.properties.ref || f.properties.name;
        const fType = (f.properties.route || "").toLowerCase().includes('tram') ? 'Tram' : 'Bus';
        return fRef == targetRef && fType == targetType;
    });

    if (segments.length > 0) {
        layers.currentLine = L.geoJSON({type: "FeatureCollection", features: segments}, {
            style: { color: "#fff", weight: 4, opacity: 0.8, dashArray: '1, 6' } // Pointillé pour ne pas surcharger
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

    const stops = getStopsForCurrentLine();

    // Convert stops → turf points
    const points = stops.map(s =>
        turf.point([s.geometry.coordinates[0], s.geometry.coordinates[1]])
    );
    const pointsFC = turf.featureCollection(points);

    // Buffer fusionnés (1, 5, 10 min)
    const buf1  = turf.buffer(pointsFC, BUFFER_CONFIG['1_min'].radius / 1000, { units: 'kilometers' });
    const buf5  = turf.buffer(pointsFC, BUFFER_CONFIG['5_min'].radius / 1000, { units: 'kilometers' });
    const buf10 = turf.buffer(pointsFC, BUFFER_CONFIG['10_min'].radius / 1000, { units: 'kilometers' });

    // Fusions
    const merged1  = turf.union(...buf1.features);
    const merged5  = turf.union(...buf5.features);
    const merged10 = turf.union(...buf10.features);

    if (state.timeFilter === 'all') {

        // HIÉRARCHISATION — découpage
        const zone10 = turf.difference(merged10, merged5) || merged10;
        const zone5  = turf.difference(merged5, merged1) || merged5;
        const zone1  = merged1;

        // AFFICHAGE
        const draw = (poly, color) => {
            if (!poly) return;
            L.geoJSON(poly, {
                pane: 'zBuffers',
                style: {
                    color,
                    weight: 1,
                    fillColor: color,
                    fillOpacity: 0.12
                },
                interactive: false
            }).addTo(layers.buffers);
        };

        draw(zone10, BUFFER_CONFIG['10_min'].color);
        draw(zone5,  BUFFER_CONFIG['5_min'].color);
        draw(zone1,  BUFFER_CONFIG['1_min'].color);

    } else {

        // Affichage d’un seul buffer
        const conf = BUFFER_CONFIG[state.timeFilter];
        const merged = 
            state.timeFilter === '1_min' ? merged1 :
            state.timeFilter === '5_min' ? merged5 :
            merged10;

        L.geoJSON(merged, {
            pane: 'zBuffers',
            style: {
                color: conf.color,
                weight: 1,
                fillColor: conf.color,
                fillOpacity: 0.12
            },
            interactive: false
        }).addTo(layers.buffers);
    }
}


// Cette fonction filtre les POIs et recalcule les stats en temps réel
function refreshAnalysis() {
    layers.pois.clearLayers();
    if (!state.currentLineKey) return;

    const lineStops = getStopsForCurrentLine();
    
    // Récupération des filtres actifs
    const catFilters = {
        "Santé": document.getElementById('toggle-sante')?.checked,
        "Éducation": document.getElementById('toggle-education')?.checked,
        "Commerces": document.getElementById('toggle-commerces')?.checked,
        "Loisirs": document.getElementById('toggle-loisirs')?.checked
    };

    // Définition du rayon max à analyser selon le filtre temporel
    let maxRadius = 0;
    if (state.timeFilter === 'all') maxRadius = BUFFER_CONFIG['10_min'].radius;
    else maxRadius = BUFFER_CONFIG[state.timeFilter].radius;

    // --- CALCUL DES STATS EN TEMPS RÉEL ---
    // On initialise les compteurs à 0
    let realTimeCounts = { "Santé": 0, "Éducation": 0, "Commerces": 0, "Loisirs": 0 };
    let filteredPois = [];

    // On parcours TOUS les POIs chargés (Attention à la perf si > 5000 points)
    // Optimisation possible : pré-filtrer par Bbox si nécessaire, mais ici on fait simple
    data.pois.features.forEach(f => {
        const cat = f.properties.categorie;
        
        // 1. Filtre Catégorie
        if (!catFilters[cat]) return;

        // 2. Filtre Spatial (Distance aux arrêts)
        // [1] = Lat, [0] = Lng
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
    let dataset = [];
    
    // Si on n'a pas de données calculées (ex: pas de ligne sélectionnée), on met tout à 0
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
                title: { display: true, text: `Services (${state.timeFilter === 'all' ? 'Max 10 min' : state.timeFilter.replace('_',' ')})`, color: '#aaa' },
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
    // On trie les clés pour avoir Tram A, Tram B... puis les Bus
    Object.keys(data.stats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true})).forEach(k => {
        const o = document.createElement('option'); o.value = k; o.innerText = k; s.appendChild(o);
    });
    s.addEventListener('change', (e) => selectLine(e.target.value));
}

function initFiltersEvents() {
    // Boutons Temps
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.timeFilter = e.target.dataset.time;
            
            // On redessine les buffers et on relance le calcul spatial
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
        cb.addEventListener('change', () => { updateVisual(); refreshAnalysis(); }); // Refresh analysis, pas juste display
        updateVisual();
    });
    
    // Checkbox Réseau Global (Fond de plan)
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
    
    // Si la modale n'est pas présente dans le HTML, on sort
    if (!modal) {
        return;
    }

    // Afficher le pop-up
    modal.style.display = 'block';

    const closeBtn = modal.querySelector('.close-btn');

    // Fonction de fermeture.
    const closeModal = () => {
        modal.style.display = 'none';
    };

    // Événements de fermeture (Bouton X et clic extérieur)
    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }
    
    // Fermeture en cliquant en dehors du contenu
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });
}

function initChart() { updateChart(null); }


document.addEventListener('DOMContentLoaded', loadData);

