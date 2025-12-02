/* =================================================================
   PAGE ACCESSIBILITÉ - LOGIQUE SPÉCIFIQUE
   ================================================================= */

// 1. INIT & CONFIG
// On utilise la carte commune
const map = initMap('map');

// Création des "Panes" spécifiques (Gestion des calques Z-Index)
// Cela permet aux points (POIs) d'être toujours au-dessus des zones colorées
map.createPane('zBackground'); map.getPane('zBackground').style.zIndex = 200;
map.createPane('zBuffers'); map.getPane('zBuffers').style.zIndex = 350;
map.createPane('zTop'); map.getPane('zTop').style.zIndex = 650;

// Variables Globales
let data = { lines: null, pois: null, stats: null };
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
    
    // Fonction utilitaire pour charger un JSON
    const charger = (url) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(url));

    Promise.all([
        charger('../data/lignes_tram.geojson'),
        charger('../data/lignes_bus.geojson'),
        // Tente de charger les IDs optimisés, sinon le fichier complet
        fetch('../data/equipements_ids.geojson').then(r => r.ok ? r.json() : charger('../data/equipements.geojson')),
        charger('../data/stats_accessibilite.json')
    ]).then(([tramLines, busLines, poisData, statsData]) => {

        data.lines = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
        data.pois = poisData;
        data.stats = statsData;

        // Init des composants
        initLineSelector();
        initChart();
        initFiltersEvents(); // Gestion des clics (remplace les onclick HTML)
        updatePoisDisplay();
        
        // Lancement UI Globale (Loader, Panel, Modales) via common.js
        initGlobalUI();

    }).catch(err => {
        console.error("Erreur chargement :", err);
        alert("Impossible de charger les données d'analyse.");
    });
}

// 3. LOGIQUE CARTE (Lignes & Isochrones)
function selectLine(lineKey) {
    state.currentLineKey = lineKey;

    // Reset visuel
    if (layers.currentLine) map.removeLayer(layers.currentLine);
    layers.buffers.clearLayers();
    document.getElementById('line-length').innerText = "-";

    if (!lineKey) return;

    // Récupération de la géométrie de la ligne
    const [targetType, targetRef] = lineKey.split(' '); 
    const segments = data.lines.features.filter(f => {
        const fRef = f.properties.ref || f.properties.name;
        const fType = (f.properties.route || "").toLowerCase().includes('tram') ? 'Tram' : 'Bus';
        return fRef == targetRef && fType == targetType;
    });

    // Affichage de la ligne sélectionnée
    if (segments.length > 0) {
        layers.currentLine = L.geoJSON({type: "FeatureCollection", features: segments}, {
            style: { color: "#fff", weight: 5, opacity: 1, shadowBlur:10 }
        }).addTo(map);
        
        // Zoom sur la ligne
        map.flyToBounds(layers.currentLine.getBounds(), { padding: [50, 50], duration: 1.2, easeLinearity: 0.25 });

        // Calcul longueur (approximatif)
        let totalMeters = 0;
        layers.currentLine.eachLayer(layer => {
            if (layer.getLatLngs) {
                const latlngs = layer.getLatLngs();
                // Gestion multi-polylines
                const parts = Array.isArray(latlngs[0]) ? latlngs : [latlngs];
                parts.forEach(part => {
                    for(let i=0; i<part.length-1; i++) totalMeters += part[i].distanceTo(part[i+1]);
                });
            }
        });
        document.getElementById('line-length').innerText = `${(totalMeters / 1000 / 2).toFixed(1)} km`;
    }

    drawBuffers();
    updatePoisDisplay();
    updateChart();
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
                pane: 'zBuffers', // Utilisation du pane personnalisé
                style: { 
                    fillColor: step.color, fillOpacity: step.opacity, 
                    weight: 1, color: step.color, dashArray: '4,4' 
                }
            }).addTo(layers.buffers);
        }
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

        // Calcul total
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

// 6. INITIALISATION DES ÉVÉNEMENTS (Clean UI)
function initLineSelector() {
    const s = document.getElementById('line-select');
    if(!data.stats) return;
    Object.keys(data.stats).sort().forEach(k => {
        const o = document.createElement('option'); o.value = k; o.innerText = k; s.appendChild(o);
    });
    s.addEventListener('change', (e) => selectLine(e.target.value));
}

function initFiltersEvents() {
    // A. Boutons de temps (1 min, 5 min...)
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Gestion de la classe active
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Mise à jour de l'état et redessin
            state.timeFilter = e.target.dataset.time; // On utilisera data-time dans le HTML
            drawBuffers();
            updatePoisDisplay();
            updateChart();
        });
    });

    // B. Checkbox Réseau Global
    const toggleNet = document.getElementById('toggle-network');
    if(toggleNet) {
        toggleNet.addEventListener('change', () => {
            layers.background.clearLayers();
            if (toggleNet.checked) {
                L.geoJSON(data.lines, {
                    style: { color: "#888", weight: 1, opacity: 0.3, dashArray: '3, 6' },
                    pane: 'zBackground', interactive: false 
                }).addTo(layers.background);
            }
        });
    }

    // C. Filtres Catégories (Santé, Loisirs...)
    // Gestion visuelle + Update
    ['toggle-sante', 'toggle-education', 'toggle-commerces', 'toggle-loisirs'].forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;

        const updateVisual = () => {
             // Astuce pour trouver le parent visuel (le label)
            let el = cb.parentElement;
            if (!cb.checked) {
                el.style.opacity = '0.5'; el.style.filter = 'grayscale(100%)'; el.style.borderColor = '#aaa'; el.style.color = '#777';
            } else {
                el.style.opacity = ''; el.style.filter = ''; el.style.borderColor = ''; el.style.color = '';
            }
        };

        cb.addEventListener('change', () => {
            updateVisual();
            updatePoisDisplay();
        });
        
        // Init state
        updateVisual();
    });
}

function initChart() { updateChart(); }

// Lancement
document.addEventListener('DOMContentLoaded', loadData);
