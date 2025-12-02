// =================================================================
// 1. CONFIGURATION
// =================================================================

const basemaps = {
    "Dark Matter": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Plan Clair": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
    "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' })
};

// Calque pour les parkings (vide au début)
let parkingLayer = L.layerGroup();

// Configuration des calques superposés (Overlays)
const overlayMaps = {
    "Parkings Relais (P+R)": parkingLayer
};

const map = L.map('map', { 
    zoomControl: false, 
    preferCanvas: false, 
    layers: [basemaps["Dark Matter"], parkingLayer] // On l'ajoute par défaut ici pour qu'il soit visible
}).setView([48.5839, 7.7448], 13);

// Contrôles
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Ajout du sélecteur de couches (Fonds + Parkings)
L.control.layers(basemaps, overlayMaps, { position: 'bottomleft', collapsed: true }).addTo(map);

let geojsonData = null;
let layerGroup = L.layerGroup().addTo(map);

const LINE_COLORS = { 'A': '#E3001B', 'B': '#0099CC', 'C': '#F29400', 'D': '#007B3B', 'E': '#B36AE2', 'F': '#98BE16', 'G': '#FFCC00', 'H': '#800020', 'BUS': '#666' };

// =================================================================
// 2. CHARGEMENT
// =================================================================

console.log("Chargement comparatif...");

// 1. Chargement des données de transport (Comparaison)
fetch('../data/comparaison_ems.geojson')
    .then(r => {
        if (!r.ok) throw new Error("Fichier comparaison introuvable");
        return r.json();
    })
    .then(data => {
        console.log(`Données transport chargées !`);
        geojsonData = data;
        
        initSearch();
        initPanel();
        renderMap(17);

        // 2. Chargement des Parkings (Une fois la carte prête)
        fetch('../data/parking_relai.geojson')
            .then(rp => {
                if (!rp.ok) throw new Error("parking_relai.geojson introuvable");
                return rp.json();
            })
            .then(pdata => {
                const parkings = L.geoJSON(pdata, {
                    pointToLayer: (feature, latlng) => {
                        // SYMBOLOGIE : Bleu P+R standard avec bordure blanche pour ressortir sur le noir
                        return L.circleMarker(latlng, {
                            radius: 6,
                            fillColor: '#0984e3', // Bleu Parking
                            color: '#ffffff',     // Bordure blanche
                            weight: 1.5,
                            fillOpacity: 0.9
                        });
                    },
                    onEachFeature: (f, l) => {
                        const name = f.properties.nom || f.properties.name || "Parking P+R";
                        const cap = f.properties.capacite || f.properties.capacity || "?";
                        
                        // Popup stylisée "Carte d'identité"
                        const html = `
                            <div style="font-family: 'Montserrat', sans-serif; text-align: center; color: #333; min-width: 160px;">
                                <div style="background: #0984e3; color: white; padding: 8px; border-radius: 4px 4px 0 0; font-weight: bold; font-size: 0.9rem;">
                                    P+R ${name}
                                </div>
                                <div style="padding: 10px; background: white; border-radius: 0 0 4px 4px;">
                                    <div style="font-size: 0.75rem; text-transform: uppercase; color: #888; margin-bottom: 2px;">Capacité</div>
                                    <div style="font-size: 1.4rem; font-weight: 800; color: #0984e3; line-height: 1;">${cap}</div>
                                    <div style="font-size: 0.75rem; color: #666;">places</div>
                                </div>
                            </div>`;
                        l.bindPopup(html);
                    }
                });
                
                parkingLayer.addLayer(parkings);
                console.log(`${pdata.features.length} Parkings chargés`);
            })
            .catch(err => console.warn("Info : Pas de fichier parkings (" + err.message + ")"));
    })
    .catch(err => alert("Erreur technique : " + err.message));

// =================================================================
// 3. AFFICHAGE (LOGIQUE CARTE)
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

function getLineBadge(name) { 
    const c = LINE_COLORS[name] || '#666'; 
    return `<span style="background:${c}; color:#fff; padding:1px 5px; border-radius:3px; font-weight:bold;">${name}</span>`; 
}

function renderMap(forceHour = null) {
    layerGroup.clearLayers();
    if (!geojsonData) return;

    const slider = document.getElementById('time-slider');
    const hour = (forceHour !== null) ? forceHour : parseInt(slider.value);
    document.getElementById('current-time-display').innerText = (hour < 10 ? '0'+hour : hour) + 'h00';

    // Filtres
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
                        const [n, x] = parts[1].split('->').map(Number);
                        const d = x - n;
                        const lColor = d > 0 ? '#2ed573' : (d < 0 ? '#ff4757' : '#888');
                        const badgeBg = LINE_COLORS[parts[0]] || '#666';
                        return `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:3px 0; font-size:0.8rem;">
                                    <span style="background:${badgeBg}; color:#fff; padding:1px 5px; border-radius:3px; font-weight:bold;">${parts[0]}</span>
                                    <span>${n} ➞ <b>${x}</b></span>
                                    <span style="color:${lColor}; font-weight:bold;">${d>0?'+':''}${d}</span>
                                </div>`;
                    }).join('');
                    detailsHtml = `<div id="det-${f.properties.nom.replace(/\W/g,'')}" style="display:none; margin-top:10px; background:#fff; padding:5px; max-height:150px; overflow-y:auto;">${rows}</div><button onclick="toggleDetails(this)" style="width:100%; margin-top:5px; border:1px solid ${color}; color:${color}; background:none; border-radius:10px; cursor:pointer; font-size:0.7rem;">▼ Détails</button>`;
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
// 4. UX & INTERACTIONS
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

function setupModal(mid, bid) {
    const m = document.getElementById(mid); const b = document.getElementById(bid);
    const c = m ? m.querySelector('.close-btn') : null;
    if (b && m) {
        b.onclick = (e) => { e.preventDefault(); m.style.display="block"; };
        if(c) c.onclick = () => m.style.display="none";
        window.addEventListener('click', (event) => { if (event.target === m) m.style.display = "none"; });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('time-slider');
    if (slider) slider.addEventListener('input', (e) => renderMap(parseInt(e.target.value)));

    setupModal("modal-info", "info-btn");
    setupModal("modal-help", "help-btn");
    
    // Gestion visuelle des filtres (Boutons colorés)
    const FILTER_IDS = ['filter-gain', 'filter-loss', 'filter-stable'];
    function updateFilterVisual(id) {
        const cb = document.getElementById(id);
        const label = cb ? cb.parentElement : null;
        if (!label) return;
        if (!cb.checked) {
            label.style.opacity = '0.5';
            label.style.filter = 'grayscale(100%)';
        } else {
            label.style.opacity = '1';
            label.style.filter = 'none';
        }
    }
    FILTER_IDS.forEach(id => {
        const cb = document.getElementById(id);
        if(cb) {
            cb.addEventListener('change', () => { updateFilterVisual(id); renderMap(null); });
            updateFilterVisual(id); // Init
        }
    });
});

window.updateMap = () => renderMap(null);
