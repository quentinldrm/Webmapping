/* =================================================================
   COMMON.JS - FONCTIONS PARTAGÉES (CARTE & UI)
   ================================================================= */

// 1. CONFIGURATION GLOBALE
const CONFIG = {
    startCenter: [48.5734, 7.7521],
    startZoom: 12,
    colors: {
        'A': '#E3001B', 'B': '#0099CC', 'C': '#F29400', 'D': '#007B3B', 
        'E': '#B36AE2', 'F': '#98BE16', 'G': '#FFCC00', 'H': '#800020', 
        'BUS': '#666666',
        'TRAM_DEFAULT': '#4cc9f0',
        'BUS_DEFAULT': '#ff9f1c'
    }
};

// 2. INITIALISATION DE LA CARTE DE BASE
function initMap(elementId = 'map') {
    const basemaps = {
        "Dark Matter": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
        "Plan Clair": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }),
        "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri' })
    };

    const map = L.map(elementId, { 
        zoomControl: false,
        layers: [basemaps["Dark Matter"]] 
    }).setView(CONFIG.startCenter, CONFIG.startZoom);

    // Contrôles standards (Bas Gauche)
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.layers(basemaps, null, { position: 'bottomleft', collapsed: true }).addTo(map);

    return map;
}

// 3. GESTION DE L'INTERFACE (LOADER, MODALES, PANEL)
function initGlobalUI() {
    
    // A. Gestion du Loader
    const loader = document.getElementById('loader');
    if(loader) { 
        setTimeout(() => {
            loader.style.opacity = 0; 
            setTimeout(() => loader.remove(), 500); 
        }, 800); // Petit délai pour être sûr que tout est chargé
    }

    // B. Gestion du Panneau Latéral (Mode Zen)
    const btnPanel = document.getElementById('toggle-panel');
    const panel = document.getElementById('controls');
    
    if(btnPanel && panel) {
        btnPanel.addEventListener('click', () => {
            panel.classList.toggle('panel-hidden');
            btnPanel.classList.toggle('is-closed');

            if (panel.classList.contains('panel-hidden')) {
                btnPanel.innerHTML = '<i class="fa-solid fa-arrow-left"></i>'; 
            } else {
                btnPanel.innerHTML = '✖';
            }
        });
    }

    // C. Gestion des Modales (Info & Aide)
    setupModal("modal-info", "info-btn");
    setupModal("modal-help", "help-btn");
}

// Helper pour les modales
function setupModal(modalId, btnId) {
    const modal = document.getElementById(modalId);
    const btn = document.getElementById(btnId);
    if (!btn || !modal) return;

    const closeBtn = modal.querySelector('.close-btn');

    btn.onclick = (e) => { e.preventDefault(); modal.style.display = "block"; };
    if (closeBtn) closeBtn.onclick = () => modal.style.display = "none";
    window.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = "none"; });
}
