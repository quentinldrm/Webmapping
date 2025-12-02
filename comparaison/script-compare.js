// =================================================================
// 1. CONFIGURATION
// =================================================================

const basemaps = {
    "Dark Matter": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Plan Clair": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' })
};

// couche dédiée pour les parkings relais (sera remplie après chargement du GeoJSON)
let parkingLayer = L.layerGroup();

// regrouper overlays pour l'ajout au contrôle des couches
const overlayMaps = {
    "Parkings relais": parkingLayer
};

const map = L.map('map', { zoomControl: false, preferCanvas: false, layers: [basemaps["Dark Matter"]] }).setView([48.5839, 7.7448], 13);

// Contrôles
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
// ajout des overlays dans le control pour obtenir le bouton/checkbox "Parkings relais"
L.control.layers(basemaps, overlayMaps, { position: 'bottomleft', collapsed: true }).addTo(map);

// Variables
let geojsonData = null;
let layerGroup = L.layerGroup().addTo(map);

const LINE_COLORS = { 'A': '#E3001B', 'B': '#0099CC', 'C': '#F29400', 'D': '#007B3B', 'E': '#B36AE2', 'F': '#98BE16', 'G': '#FFCC00', 'H': '#800020', 'BUS': '#666' };

// =================================================================
// 2. CHARGEMENT
// =================================================================

console.log("Chargement comparatif...");

fetch('../data/comparaison_ems.geojson')
    .then(r => {
        if (!r.ok) throw new Error("Fichier introuvable");
        return r.json();
    })
    .then(data => {
        console.log(`Fichier chargé !`);
        geojsonData = data;
        
        initSearch();
        initPanel();
        renderMap(17);

        // charge aussi le fichier parking_relai.geojson et l'ajoute dans parkingLayer (overlay)
        fetch('../data/parking_relai.geojson')
            .then(rp => {
                if (!rp.ok) throw new Error("parking_relai.geojson introuvable");
                return rp.json();
            })
            .then(pdata => {
                const parkings = L.geoJSON(pdata, {
                    pointToLayer: (feature, latlng) => {
                        // style simple et cohérent avec le reste de la carte
                        return L.circleMarker(latlng, {
                            radius: 6,
                            fillColor: '#666',
                            color: '#333',
                            weight: 1,
                            fillOpacity: 0.95
                        });
                    },
                    onEachFeature: (f, l) => {
                        const name = f.properties.nom || f.properties.name || "Parking relais";
                        const cap = f.properties.capacite || f.properties.capacity || "";
                        const html = `<div style="font-family:Montserrat, sans-serif; min-width:160px;">
                                        <strong>${name}</strong>
                                        ${cap ? `<div style="margin-top:6px;"><small>Capacité: <b>${cap}</b></small></div>` : ''}
                                      </div>`;
                        l.bindPopup(html);
                    }
                });
                parkingLayer.addLayer(parkings);
                // Si vous voulez l'afficher par défaut à l'ouverture, décommentez la ligne suivante:
                // parkingLayer.addTo(map);
                console.log("Parkings relais chargés :", pdata.features.length);
            })
            .catch(err => console.warn("Erreur chargement parkings :", err.message));

        const loader = document.getElementById('loader');
        if(loader) {
            loader.style.opacity = 0;
            setTimeout(() => loader.remove(), 500);
        }
    })
    .catch(err => alert("Erreur technique : " + err.message));

// =================================================================
// 3. AFFICHAGE
// =================================================================

function getStyle(diffRaw) {
    const diff = Number(diffRaw) || 0;
    let color = '#fff'; 
    if (diff > 0) color = '#2ed573';
    if (diff < 0) color = '#ff4757';
    
    let radius = 3;
    if (diff !== 0) radius = Math.max(3, Math.min(Math.sqrt(Math.abs(diff)) * 3, 20));
    return { color, radius };
}

function getLineBadge(name) { const c = LINE_COLORS[name] || '#666'; return `<span style="background:${c}; color:#fff; padding:1px 5px; border-radius:3px; font-weight:bold;">${name}</span>`; }

function renderMap(forceHour = null) {
    layerGroup.clearLayers();
    if (!geojsonData) return;

    const slider = document.getElementById('time-slider');
    const hour = (forceHour !== null) ? forceHour : parseInt(slider.value);
    document.getElementById('current-time-display').innerText = (hour < 10 ? '0'+hour : hour) + 'h00';

    const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : true; };
    const showGain = getCheck('filter-gain');
    const showLoss = getCheck('filter-loss');
    const showStable = getCheck('filter-stable');

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
                        const subparts = parts[1].split('->').map(s => s.trim());
                        const n = Number(subparts[0]) || 0;
                        const x = Number(subparts[1]) || 0;
                        const d = x - n;
                        const lColor = d > 0 ? '#2ed573' : (d < 0 ? '#ff4757' : '#888');
                        return `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:3px 0; font-size:0.8rem;">
                                    ${getLineBadge(parts[0])}
                                    <span>${n} ➞ <b style="color:${lColor}">${x}</b></span>
                                </div>`;
                    }).join('');
                    detailsHtml = `<div id="det-${String(f.properties.nom || '').replace(/\W/g,'')}" style="display:none; margin-top:10px; background:#fff; padding:5px; max-height:150px; overflow-y:auto;">${rows}</div>`;
                }

                l.bindPopup(`
                    <div style="text-align:center; font-family:'Montserrat', sans-serif; color:#333; min-width:160px;">
                        <strong style="font-size:1.1em;">${f.properties.nom}</strong><br>
                        <small>${f.properties.type}</small>
                        <hr style="margin:8px 0; border:0; border-top:1px solid #ddd;">
                        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                            <span>Std: <b>${norm}</b></span> <span>Noël: <b>${noel}</b></span>
                        </div>
                        <div style="background:#f4f4f4; padding:5px; margin-top:5px;">
                            <span style="font-size:1.4rem; font-weight:800; color:${color};">${sign}${diff}</span>
                            <span style="font-size:0.8rem; font-weight:bold; color:${color}; margin-left:5px;">(${sign}${pct}%)</span>
                        </div>
                        ${detailsHtml}
                    </div>
                `);
            }
        }).addTo(layerGroup);
    } catch (e) { console.error(e); }

    const kpi = document.getElementById('kpi-summary');
    if(kpi) {
        let html = [];
        if (stats.gain > 0) html.push(`<span style="color:#2ed573">▲ ${stats.gain} arrêts</span>`);
        if (stats.loss > 0) html.push(`<span style="color:#ff4757">▼ ${stats.loss} arrêts</span>`);
        kpi.innerHTML = html.length ? html.join(' &nbsp; ') : "Stable";
    }
}

// =================================================================
// 4. FONCTIONS UX (RECHERCHE & ZEN)
// =================================================================

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

window.toggleDetails = function(btn) {
    const div = btn.previousElementSibling;
    if (div.style.display === 'none') { div.style.display = 'block'; btn.innerText = '▲ Masquer'; } 
    else { div.style.display = 'none'; btn.innerText = '▼ Détails'; }
};

// Gestion Modals
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
    const slider = document.getElementById('time-slider');
    if (slider) slider.addEventListener('input', (e) => renderMap(parseInt(e.target.value)));

    setupModal("modal-info", "info-btn");
    setupModal("modal-help", "help-btn");

    const FILTER_IDS = ['filter-gain', 'filter-loss', 'filter-stable'];

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
            // état désactivé -> gris
            vis.style.opacity = '0.5';
            vis.style.filter = 'grayscale(100%)';
            vis.style.borderColor = '#aaa';
            vis.style.color = '#777';
        } else {
            // restaurer styles par défaut
            vis.style.opacity = '';
            vis.style.filter = '';
            vis.style.borderColor = '';
            vis.style.color = '';
        }
    }

    FILTER_IDS.forEach(id => {
        const cb = document.getElementById(id);
        if (!cb) return;
        cb.addEventListener('change', () => {
            updateFilterButtonVisual(id);
            renderMap(null);
        });
        // état initial
        updateFilterButtonVisual(id);
    });
});


window.updateMap = () => renderMap(null);
