/* =================================================================
   PAGE RYTHME - LOGIQUE SPÉCIFIQUE (VERSION FIBRE OPTIQUE / DARK)
   ================================================================= */

// 1. VARIABLES & INIT
const map = initMap('map'); 

let rawData = { stops: null, lines: null };
let layers = { stops: null, lines: null };
let animationInterval = null;
let networkChart = null;

// 2. CHARGEMENT DES DONNÉES
function loadData() {
    console.log("Chargement Données Rythme...");
    Promise.all([
        fetch('../data/lignes_tram.geojson').then(r => r.json()),
        fetch('../data/lignes_bus.geojson').then(r => r.json()),
        fetch('../data/frequence_ems.geojson').then(r => r.json())
    ]).then(([tramLines, busLines, stopsData]) => {

        rawData.lines = { type: "FeatureCollection", features: [...tramLines.features, ...busLines.features] };
        rawData.stops = stopsData;

        initLineSelector();
        initSearch();
        initChart();
        initPlayer();

        updateVisualization();

        // Initialisation UI globale si existante
        if (typeof initGlobalUI === 'function') initGlobalUI();

    }).catch(err => {
        console.error("Erreur chargement :", err);
        alert("Impossible de charger les données cartographiques.");
    });
}

// =================================================================
// 3. MOTEUR GRAPHIQUE (STYLE NÉON FIN)
// =================================================================

function getDynamicColor(feature, freq) {
    const type = (feature.properties.type || "").toLowerCase();
    const lignes = (feature.properties.liste_lignes || "").toLowerCase();
    
    // Filtres UI
    const showTram = document.getElementById('toggle-tram').checked;
    const selectedLine = document.getElementById('line-select').value;
    
    // Si une ligne de bus spécifique (ex: "10", "G") est sélectionnée (pas "a".."f")
    let isBusLineSelected = (selectedLine !== 'all' && !/^[a-f]$/i.test(selectedLine));

    // Ratio d'intensité (saturé à 30 passages/h pour l'effet visuel)
    const maxFreqForGradient = 30; 
    const ratio = Math.min(freq, maxFreqForGradient) / maxFreqForGradient;

    let hue, saturation, lightness;

    // Détection Tram vs Bus
    const isTramFeature = (type.includes('tram') || /[a-f]/.test(lignes));
    const forceBusColor = (!showTram || isBusLineSelected);

    if (!forceBusColor && isTramFeature) {
        // --- TRAM : CYAN vers BLEU ÉLECTRIQUE ---
        // Hue 180 (Cyan) -> 220 (Bleu)
        hue = 180 + (ratio * 40);
        saturation = 100; 
        // Luminosité : 50% (couleur pure) -> 90% (presque blanc/brillant)
        lightness = 50 + (ratio * 40); 
    } else {
        // --- BUS : ORANGE vers ROUGE vers ROSE ---
        // On traverse le cercle chromatique via le rouge (0/360)
        if (ratio < 0.5) {
             // Partie 1 : De Orange (40) vers Rouge (0)
             // (ratio * 2) permet d'aller de 0 à 1 sur la première moitié
             hue = 40 - (ratio * 2 * 40);
        } else {
             // Partie 2 : De Rouge (360) vers Rose (320)
             // ((ratio - 0.5) * 2) permet d'aller de 0 à 1 sur la seconde moitié
             hue = 360 - ((ratio - 0.5) * 2 * 40);
        }
        
        saturation = 90;
        lightness = 50 + (ratio * 30); // Monte jusqu'à 80% (rose pâle brillant)
    }

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// TAILLE : Beaucoup plus petite pour éviter l'effet "paté"
function getRadius(freq) { 
    if (!freq) return 0;
    // Min 1.5px, Max 8px (au lieu de 22px avant)
    return Math.max(1.5, Math.min(Math.sqrt(freq) * 1.2, 8)); 
}

// Couleurs fixes pour les textes
function getColor(type) { 
    return (type || "").toLowerCase().includes('tram') ? '#00f3ff' : '#ff0055'; 
}

function getLineBadge(lineName) {
    // Couleurs par défaut si CONFIG n'est pas dispo
    const defaultColor = /^[a-f]$/i.test(lineName) ? '#4361ee' : '#f72585'; 
    const color = (typeof CONFIG !== 'undefined' && CONFIG.colors[lineName]) ? CONFIG.colors[lineName] : defaultColor;
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
            weight: (selectedLine === f.properties.ref) ? 3 : 1, // Lignes très fines
            // Très transparentes pour ne pas voler la vedette aux points
            opacity: (selectedLine === 'all' || selectedLine === f.properties.ref) ? 0.3 : 0.05
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
    
    const propHour = 'h_' + hour;
    const propDetail = 'd_' + hour;

    layers.stops = L.geoJSON(rawData.stops, {
        filter: f => {
            // --- LOGIQUE DE FILTRE ---
            const selectedLine = document.getElementById('line-select').value;
            const rawLines = (f.properties.liste_lignes || "").toString();
            const linesArray = rawLines.toLowerCase().split(',').map(l => l.trim());

            if (selectedLine !== 'all') {
                if (!linesArray.includes(selectedLine.toLowerCase())) return false; 
            }

            const typeRaw = (f.properties.type || "").toLowerCase();
            const tramLetters = ['a', 'b', 'c', 'd', 'e', 'f'];

            const hasTram = typeRaw.includes('tram') || linesArray.some(l => tramLetters.includes(l));
            const hasBus = typeRaw.includes('bus') || /\d/.test(rawLines) || linesArray.some(l => !tramLetters.includes(l));

            const showTram = document.getElementById('toggle-tram').checked;
            const showBus = document.getElementById('toggle-bus').checked;

            if (hasTram && hasBus) return (showTram || showBus);
            if (hasTram && !hasBus) return showTram;
            if (!hasTram && hasBus) return showBus;

            return false;
        },
        pointToLayer: (f, latlng) => {
            const freq = f.properties[propHour] || 0;
            const color = getDynamicColor(f, freq);
            
            // Opacité : On démarre bas (0.4) pour permettre l'accumulation de lumière
            const dynamicOpacity = 0.4 + (Math.min(freq, 30) / 30) * 0.5;

            return L.circleMarker(latlng, {
                radius: getRadius(freq),
                
                fillColor: color,
                fillOpacity: dynamicOpacity,
                
                // IMPORTANT : Pas de contour pour l'effet "particule de lumière"
                stroke: false,
                
                // Classe CSS pour activer le mix-blend-mode: screen
                className: 'glowing-marker' 
            });
        },
        onEachFeature: (f, l) => {
            const totalPassages = f.properties[propHour] || 0;
            const detailsRaw = f.properties[propDetail] || "";
            let detailsHtml = "";

            if (detailsRaw && totalPassages > 0) {
                const items = detailsRaw.split(', ').map(item => {
                    const parts = item.split(':');
                    if (parts.length < 2) return "";
                    return `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding:4px 0;">
                            <div>${getLineBadge(parts[0])}</div>
                            <span style="font-size:0.85rem; color:#555;"><b>${parts[1]}</b> pass.</span>
                        </div>`;
                }).join('');
                
                detailsHtml = `<div class="popup-details" style="display:none; margin-top:10px; background:#fff; padding:5px 8px; border-radius:4px; max-height:150px; overflow-y:auto; box-shadow:inset 0 0 5px rgba(0,0,0,0.05);">${items}</div>
                    <button onclick="togglePopupDetails(this)" style="width:100%; margin-top:8px; background:transparent; border:1px solid #666; color:#666; border-radius:12px; padding:4px; cursor:pointer; font-size:0.75rem; transition:0.2s;">▼ Détails Fréquence</button>`;
            }

            l.bindPopup(`
                <div style="font-family: 'Montserrat', sans-serif; text-align: center; color: #333; min-width: 180px;">
                    <div style="font-size: 1.1rem; font-weight: 800; text-transform: uppercase; margin-bottom:5px;">${f.properties.nom}</div>
                    <div style="margin-bottom:10px; font-size:0.85rem; color:#666;">Lignes : <strong>${f.properties.liste_lignes || ""}</strong></div>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
                    <div style="line-height: 1;">
                        <span style="font-size: 2.2rem; font-weight: 800; color: ${getColor(f.properties.type)}; text-shadow: 0 0 5px rgba(0,0,0,0.1);">${totalPassages}</span>
                        <span style="font-size: 0.9rem; font-weight: 600; color: #666;">passages/h</span>
                    </div>
                    <div style="font-size: 0.8rem; color: #999; margin-top: 4px;">à ${hour}h00</div>
                    ${detailsHtml}
                </div>
            `);
        }
    }).addTo(map);
}

// Fonction globale pour le popup
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

// 4. UX & CHART
function initSearch() {
    const input = document.getElementById('stop-search');
    const resultsDiv = document.getElementById('search-results');
    if (!input || !rawData.stops) return;

    input.addEventListener('input', function(e) {
        const val = this.value.toLowerCase();
        resultsDiv.innerHTML = '';
        if (val.length < 2) { resultsDiv.style.display = 'none'; return; }

        const matches = rawData.stops.features.filter(f => f.properties.nom.toLowerCase().includes(val)).slice(0, 8);

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
                            if (layer.feature && layer.feature.properties.nom === f.properties.nom) layer.openPopup();
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
    // Tri Alpha-numérique
    linesList.sort((a, b) => (a.type !== b.type) ? (a.type==='tram'?-1:1) : a.ref.localeCompare(b.ref, undefined, {numeric:true}));
    linesList.forEach(l => { 
        const o = document.createElement('option'); o.value = l.ref; o.innerText = l.label; s.appendChild(o); 
    });
    s.addEventListener('change', updateVisualization);
}

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

    networkChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: heures,
            datasets: [{
                label: 'Passages', data: totaux,
                borderColor: '#00f3ff', // Cyan Néon
                backgroundColor: 'rgba(0, 243, 255, 0.1)',
                borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, title: { display: true, text: 'Charge du Réseau', color: '#888', font: {size:10} } },
            scales: {
                x: { display: true, ticks: { color: '#666', font: { size: 9 }, maxTicksLimit: 6 }, grid: { display: false } },
                y: { display: true, beginAtZero: true, suggestedMax: Math.max(...totaux) * 1.1, ticks: { color: '#666', font: { size: 9 }, maxTicksLimit: 5 }, grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } }
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
        pointColors[index] = '#fff'; pointBorderColors[index] = '#00f3ff'; pointRadii[index] = 6;
    }
    networkChart.data.datasets[0].pointBackgroundColor = pointColors;
    networkChart.data.datasets[0].pointBorderColor = pointBorderColors;
    networkChart.data.datasets[0].pointRadius = pointRadii;
    networkChart.update();
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

// Filtres Checkbox
['toggle-tram', 'toggle-bus'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateVisualization);
});

// Lancement
document.addEventListener('DOMContentLoaded', loadData);
