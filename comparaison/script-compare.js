/* =================================================================
   PAGE COMPARAISON - LOGIQUE SPÉCIFIQUE
   ================================================================= */

// 1. INIT & CONFIG
const map = initMap('map');

// Création des Panes
map.createPane('zBackground'); map.getPane('zBackground').style.zIndex = 200;
map.createPane('zParkings'); map.getPane('zParkings').style.zIndex = 450; // Utilisé pour Parkings & Marchés

// Groupe de calques
const layers = {
    background: L.layerGroup().addTo(map), 
    comparison: L.layerGroup().addTo(map), 
    parkings: L.layerGroup(),
    markets: L.layerGroup(), // NOUVEAU
    infos: L.layerGroup()    // NOUVEAU
};

// Variables de données
let geojsonData = null;
let networkData = null;

const LINE_COLORS = { 
    'A': '#E3001B', 'B': '#0099CC', 'C': '#F29400', 'D': '#007B3B', 
    'E': '#B36AE2', 'F': '#98BE16', 'G': '#FFCC00', 'H': '#800020', 
    'BUS': '#666666' 
};

// 2. CHARGEMENT DES DONNÉES
function loadData() {
    console.log("Chargement Données Comparaison...");

    Promise.all([
        fetch('../data/comparaison_ems.geojson').then(r => r.json()),
        fetch('../data/parking_relai.geojson').then(r => r.json()),
        fetch('../data/lignes_tram.geojson').then(r => r.json()),
        fetch('../data/lignes_bus.geojson').then(r => r.json()),
        fetch('../data/marche_noel.geojson').then(r => r.json()) 
    ]).then(([compData, parkingData, tramLines, busLines, xmasData]) => {
        
        geojsonData = compData;
        networkData = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
        
        // Initialisation des différentes couches
        initParkings(parkingData);
        initChristmasMarkers(xmasData);
        initSearch();
        initEvents();
        
        // Premier rendu
        renderMap(17);
        
        // Activation UI Globale
        initGlobalUI();

        // Activation par défaut selon l'état des checkbox HTML
        checkDefaultLayers();

    }).catch(err => {
        console.error("Erreur chargement :", err);
        alert("Impossible de charger les données.");
    });
}

function checkDefaultLayers() {
    if(document.getElementById('toggle-parking')?.checked) layers.parkings.addTo(map);
    if(document.getElementById('toggle-markets')?.checked) layers.markets.addTo(map);
    if(document.getElementById('toggle-infos')?.checked) layers.infos.addTo(map);
}

// 3. LOGIQUE CARTE (PARKINGS)
function initParkings(data) {
    L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const parkingIcon = L.divIcon({
                className: 'custom-parking-icon',
                html: '<div class="parking-marker-symbol">P+R</div>',
                iconSize: [24, 36], iconAnchor: [12, 12]
            });
            return L.marker(latlng, { icon: parkingIcon, pane: 'zParkings' });
        },
        onEachFeature: (f, l) => {
            const name = f.properties.nom || f.properties.name || "Parking P+R";
            const cap = f.properties.cap || f.properties.cap || "?";
            l.bindPopup(createPopupContent(name, "Parking Relais", cap + " places", "#0984e3"));
        }
    }).addTo(layers.parkings);
}

// 4. LOGIQUE CARTE (MARCHÉS & INFOS) - NOUVEAU
function initChristmasMarkers(data) {
    L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {

            const typeRaw = (feature.properties.Type || "").toLowerCase();
            const isMarket = typeRaw.includes('march') || typeRaw.includes('macrh');
            
            if (isMarket) {
                const mIcon = L.divIcon({
                    className: 'custom-parking-icon',
                    html: '<div class="market-marker-symbol"><i class="fa-solid fa-gift"></i></div>',
                    iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -20]
                });
                return L.marker(latlng, { icon: mIcon, pane: 'zParkings' });
            } else {

                const iIcon = L.divIcon({
                    className: 'custom-parking-icon',
                    html: '<div class="info-marker-symbol">i</div>',
                    iconSize: [22, 22], iconAnchor: [11, 11]
                });
                return L.marker(latlng, { icon: iIcon, pane: 'zParkings' });
            }
        },
        onEachFeature: (f, l) => {
            const typeRaw = (f.properties.Type || "").toLowerCase();
            const isMarket = typeRaw.includes('march') || typeRaw.includes('macrh');
            
            const nom = f.properties.Nom || "Lieu de Noël";
            

            if (isMarket) {
                layers.markets.addLayer(l);
                l.bindPopup(createPopupContent(nom, "Marché de Noël", "Animations & Cadeaux", "#e55039"));
            } else {
                layers.infos.addLayer(l);
                l.bindPopup(createPopupContent(nom, "Point Info", "Informations Noël", "#6a89cc"));
            }
        }
    });
}

// Helper pour créer les popups harmonisés
function createPopupContent(title, subtitle, info, color) {
    return `
        <div style="font-family: 'Montserrat', sans-serif; text-align: center; color: #333; min-width: 160px;">
            <div style="background: ${color}; color: white; padding: 8px; border-radius: 4px 4px 0 0; font-weight: bold; font-size: 0.9rem;">
                ${title}
            </div>
            <div style="padding: 10px; background: white; border-radius: 0 0 4px 4px;">
                <div style="font-size: 0.75rem; text-transform: uppercase; color: #888; margin-bottom: 2px;">${subtitle}</div>
                <div style="font-size: 1.1rem; font-weight: 800; color: ${color}; line-height: 1;">${info}</div>
            </div>
        </div>`;
}


// 5. LOGIQUE CARTE (COMPARAISON - inchangée)
function getStyle(diffRaw) {
    const diff = Number(diffRaw) || 0;
    let color = '#fff'; 
    if (diff > 0) color = '#2ed573';
    if (diff < 0) color = '#ff4757';
    let radius = 3;
    if (diff !== 0) radius = Math.max(3, Math.min(Math.sqrt(Math.abs(diff)) * 3, 20));
    return { color, radius };
}

function renderMap(forceHour = null) {
    layers.comparison.clearLayers();
    if (!geojsonData) return;

    const slider = document.getElementById('time-slider');
    const hour = (forceHour !== null) ? forceHour : parseInt(slider.value);
    document.getElementById('current-time-display').innerText = (hour < 10 ? '0'+hour : hour) + 'h00';

    const showGain = document.getElementById('filter-gain').checked;
    const showLoss = document.getElementById('filter-loss').checked;
    const showStable = document.getElementById('filter-stable').checked;

    const colDiff = `diff_${hour}`;
    const colPct = `pct_${hour}`;
    const colNorm = `h_${hour}_norm`;
    const colNoel = `h_${hour}_noel`;
    const colDetails = `details_${hour}`;

    let stats = { gain: 0, loss: 0 };

    try {
        L.geoJSON(geojsonData, {
            filter: f => {
                const diff = Number(f.properties[colDiff]) || 0;
                if (diff > 0) { stats.gain++; return showGain; }
                if (diff < 0) { stats.loss++; return showLoss; }
                return showStable;
            },
            pointToLayer: (feature, latlng) => {
                const diff = feature.properties[colDiff];
                const style = getStyle(diff);
                return L.circleMarker(latlng, {
                    radius: style.radius, fillColor: style.color, color: style.color, weight: 1, fillOpacity: 0.8
                });
            },
            onEachFeature: (f, l) => {
                const diff = f.properties[colDiff] || 0;
                const pct = f.properties[colPct] || 0;
                const norm = f.properties[colNorm] || 0;
                const noel = f.properties[colNoel] || 0;
                const detailsStr = f.properties[colDetails] || "";

                const sign = diff > 0 ? '+' : '';
                const color = diff > 0 ? '#2ed573' : (diff < 0 ? '#ff4757' : '#fff');

                let detailsHtml = "";
                if (detailsStr) {
                    const lines = detailsStr.split('|');
                    const rows = lines.map(lineStr => {
                        const parts = lineStr.split(':');
                        if(parts.length < 2) return "";
                        const nums = parts[1].split('->').map(Number);
                        const n = nums[0] || 0; const x = nums[1] || 0;
                        const d = x - n;
                        const lColor = d > 0 ? '#2ed573' : (d < 0 ? '#ff4757' : '#888');
                        const badgeBg = LINE_COLORS[parts[0]] || '#666';
                        return `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:3px 0; font-size:0.8rem;">
                                    <span style="background:${badgeBg}; color:#fff; padding:1px 5px; border-radius:3px; font-weight:bold;">${parts[0]}</span>
                                    <span>${n} ➞ <b>${x}</b></span>
                                    <span style="color:${lColor}; font-weight:bold;">${d>0?'+':''}${d}</span>
                                </div>`;
                    }).join('');
                    detailsHtml = `<div class="popup-details" style="display:none; margin-top:10px; background:#fff; padding:5px; max-height:150px; overflow-y:auto; border-radius:4px;">${rows}</div>
                                   <button onclick="toggleDetails(this)" style="width:100%; margin-top:5px; border:none; background:none; color:#666; cursor:pointer; font-size:0.75rem;">▼ Détails</button>`;
                }

                l.bindPopup(`
                    <div style="text-align:center; font-family:'Montserrat', sans-serif; color:#333; min-width:160px;">
                        <strong style="font-size:1.1em;">${f.properties.nom}</strong><br>
                        <small>${f.properties.type}</small>
                        <hr style="margin:8px 0; border:0; border-top:1px solid #ddd;">
                        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                            <span>Std: <b>${norm}</b></span> <span>Noël: <b>${noel}</b></span>
                        </div>
                        <div style="background:#f4f4f4; padding:5px; margin-top:5px; border-radius:4px;">
                            <span style="font-size:1.4rem; font-weight:800; color:${color};">${sign}${diff}</span>
                            <span style="font-size:0.8rem; font-weight:bold; color:${color}; margin-left:5px;">(${sign}${pct}%)</span>
                        </div>
                        ${detailsHtml}
                    </div>`);
            }
        }).addTo(layers.comparison);
    } catch (e) { console.error(e); }

    const kpi = document.getElementById('kpi-summary');
    if(kpi) {
        let html = [];
        if (stats.gain > 0) html.push(`<span style="color:#2ed573">▲ ${stats.gain} arrêts</span>`);
        if (stats.loss > 0) html.push(`<span style="color:#ff4757">▼ ${stats.loss} arrêts</span>`);
        kpi.innerHTML = html.length ? html.join(' &nbsp; ') : "Stable";
    }
}

window.toggleDetails = function(btn) {
    const div = btn.previousElementSibling;
    if (div.style.display === 'none') { div.style.display = 'block'; btn.innerText = '▲ Masquer'; } 
    else { div.style.display = 'none'; btn.innerText = '▼ Détails'; }
};

// 6. EVENTS
function initEvents() {
    // Slider
    const slider = document.getElementById('time-slider');
    if (slider) slider.addEventListener('input', (e) => renderMap(parseInt(e.target.value)));

    // Filtres Gain/Perte
    ['filter-gain', 'filter-loss', 'filter-stable'].forEach(id => {
        const cb = document.getElementById(id);
        if(cb) {
            cb.addEventListener('change', () => { updateFilterVisual(id); renderMap(); });
            updateFilterVisual(id);
        }
    });

    // Checkbox Parking
    document.getElementById('toggle-parking')?.addEventListener('change', (e) => {
         if(e.target.checked) layers.parkings.addTo(map); else map.removeLayer(layers.parkings);
    });

    // Checkbox Marchés
    document.getElementById('toggle-markets')?.addEventListener('change', (e) => {
         if(e.target.checked) layers.markets.addTo(map); else map.removeLayer(layers.markets);
    });

    // Checkbox Infos
    document.getElementById('toggle-infos')?.addEventListener('change', (e) => {
         if(e.target.checked) layers.infos.addTo(map); else map.removeLayer(layers.infos);
    });

    // Checkbox Réseau
    const toggleNet = document.getElementById('toggle-network');

    if (toggleNet && networkData) {
        toggleNet.addEventListener('change', () => {
            layers.background.clearLayers();
            
            if (toggleNet.checked) {
                L.geoJSON(networkData, {
                    style: function(feature) {
                        
                        const type = feature.properties.route; 

                        switch (type) {
                            case 'tram':
                                return { color: "#4cc9f0", weight: 2, opacity: 0.3 };
                            case 'bus':
                                return { color: "#ff9f1c", weight: 1, opacity: 0.3, dashArray: '3, 6' };
                            default:
                                return { color: "#888", weight: 1, opacity: 0.3, dashArray: '3, 6' };
                        }
                    },
                    pane: 'zBackground', 
                    interactive: false 
                }).addTo(layers.background);
            }
        });
    }
}

function updateFilterVisual(id) {
    const cb = document.getElementById(id);
    const label = cb ? cb.parentElement : null;
    if (!label) return;
    if (!cb.checked) {
        label.style.opacity = '0.5'; label.style.filter = 'grayscale(100%)';
    } else {
        label.style.opacity = '1'; label.style.filter = 'none';
    }
}

function initSearch() {
    const input = document.getElementById('stop-search');
    const resDiv = document.getElementById('search-results');
    if (!input || !geojsonData) return;

    input.addEventListener('input', function(e) {
        const val = this.value.toLowerCase();
        resDiv.innerHTML = '';
        if (val.length < 2) { resDiv.style.display = 'none'; return; }
        const matches = geojsonData.features.filter(f => f.properties.nom.toLowerCase().includes(val)).slice(0, 8);
        if (matches.length > 0) {
            resDiv.style.display = 'block';
            matches.forEach(f => {
                const div = document.createElement('div');
                div.className = 'result-item';
                div.innerHTML = `<span>${f.properties.nom}</span>`;
                div.onclick = () => {
                    const [lng, lat] = f.geometry.coordinates;
                    map.flyTo([lat, lng], 16, { duration: 1.5 });
                    setTimeout(() => { map.eachLayer(l => { if(l.feature && l.feature.properties.nom===f.properties.nom) l.openPopup(); }); }, 1600);
                    input.value = f.properties.nom; resDiv.style.display = 'none';
                };
                resDiv.appendChild(div);
            });
        } else { resDiv.style.display = 'none'; }
    });
    document.addEventListener('click', (e) => { if (e.target!==input && e.target!==resDiv) resDiv.style.display = 'none'; });
}

// GESTION DU POP-UP DE BIENVENUE
function showWelcomePopup() {
    const modalId = 'welcome-modal';
    const modal = document.getElementById(modalId);
    
    // Si la modale n'est pas présente dans le HTML, on sort
    if (!modal) {
        return;
    }

    // Affiche le pop-up à chaque appel (car la vérification localStorage a été retirée)
    modal.style.display = 'block';

    const closeBtn = modal.querySelector('.close-btn');

    // Fonction de fermeture
    const closeModal = () => {
        modal.style.display = 'none';
        // Note: localStorage est intentionnellement retiré pour forcer l'affichage à chaque visite
    };

    // Événements de fermeture (Bouton X et clic extérieur)
    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }
    
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });
}

document.addEventListener('DOMContentLoaded', loadData);

