document.addEventListener('DOMContentLoaded', function() {
    
    // --- VARIABLES GLOBALES ---
    let map;
    let previewMarker;
    let polygonLayer;
    let pointsList = []; 
    let currentCalc = null; 
    let infoControl; 

    // --- ARRANQUE ---
    initMap();
    setupEventListeners();
    initTutorial(); // Inicializar configuración del tutorial

    // --- 0. CONFIGURACIÓN DEL TUTORIAL (DRIVER.JS) ---
    function initTutorial() {
        const driver = window.driver.js.driver;
        
        const driverObj = driver({
            showProgress: true,
            animate: true,
            // Textos en español
            nextBtnText: 'Siguiente →',
            prevBtnText: '← Atrás',
            doneBtnText: '¡Entendido!',
            steps: [
                { 
                    element: '.header-app', 
                    popover: { 
                        title: 'Bienvenido a GeoCalc Pro', 
                        description: 'Tu navaja suiza para conversiones de coordenadas y levantamientos rápidos.' 
                    } 
                },
                { 
                    element: '#tourStepMode', 
                    popover: { 
                        title: 'Modo de Entrada', 
                        description: 'Elige si vas a ingresar Lat/Lon (Grados Decimales) o Coordenadas UTM.' 
                    } 
                },
                { 
                    element: '#btnGps', 
                    popover: { 
                        title: 'GPS en Campo', 
                        description: 'Usa este botón para capturar tu ubicación actual con el GPS del celular.' 
                    } 
                },
                { 
                    element: '#tourStepMap', 
                    popover: { 
                        title: 'Mapa Interactivo', 
                        description: 'Puedes tocar cualquier parte del mapa para capturar una coordenada. Usa el control de capas arriba a la derecha para ver Satélite o Topografía.' 
                    } 
                },
                { 
                    element: '#tourStepImport', 
                    popover: { 
                        title: 'Carga Masiva', 
                        description: '¿Tienes un archivo de Excel/Bloc de notas? Súbelo aquí. Aceptamos TXT y CSV.' 
                    } 
                },
                { 
                    element: '#tourStepExport', 
                    popover: { 
                        title: 'Exportación', 
                        description: 'Al finalizar tu polígono, descárgalo para usarlo en Google Earth (KML) o QGIS (GeoJSON).' 
                    } 
                }
            ]
        });

        // Botón Manual del Header
        const btnTour = document.getElementById('startTourBtn');
        if(btnTour) {
            btnTour.addEventListener('click', () => driverObj.drive());
        }

        // Auto-start (Solo la primera vez)
        if (!localStorage.getItem('geoCalcTourSeen')) {
            // Pequeño delay para asegurar que cargó todo visualmente
            setTimeout(() => {
                driverObj.drive();
                localStorage.setItem('geoCalcTourSeen', 'true');
            }, 1000);
        }
    }

    // --- 1. CONFIGURACIÓN DEL MAPA ---
    function initMap() {
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
        const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' });
        const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap' });

        map = L.map('map', { scrollWheelZoom: false, layers: [osm] }).setView([16.75, -93.11], 10);

        // Ctrl + Scroll
        const mapContainer = document.getElementById('map');
        const overlay = document.getElementById('zoomOverlay');
        mapContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault(); 
                e.deltaY < 0 ? map.zoomIn() : map.zoomOut();
            } else {
                overlay.classList.add('visible');
                clearTimeout(window.overlayTimer);
                window.overlayTimer = setTimeout(() => overlay.classList.remove('visible'), 1500);
            }
        }, { passive: false });

        polygonLayer = L.polygon([], {color: 'blue', fillColor: '#3388ff', fillOpacity: 0.2}).addTo(map);
        previewMarker = L.marker([0,0], {opacity: 0.6}).addTo(map);

        L.control.layers(
            { "Callejero": osm, "Satélite": sat, "Topográfico": topo },
            { "Polígono": polygonLayer, "Marcador": previewMarker },
            { position: 'topright' }
        ).addTo(map);

        infoControl = L.control({position: 'bottomleft'});
        infoControl.onAdd = function() { this._div = L.DomUtil.create('div', 'info-stats'); this.update(); return this._div; };
        infoControl.update = function(props) {
            this._div.innerHTML = '<h6>Mediciones</h6>' + (props ? 
                `<span><b>Área:</b> ${props.area} m²</span><span><b>Has:</b> ${props.has}</span><span><b>Perim:</b> ${props.perim} m</span>` 
                : '<span>Agrega 3+ puntos...</span>');
        };
        infoControl.addTo(map);

        map.on('click', function(e) {
            document.getElementById('modeGeo').checked = true; toggleInputs();
            document.getElementById('latInput').value = e.latlng.lat.toFixed(6);
            document.getElementById('lonInput').value = e.latlng.lng.toFixed(6);
            calculatePreview();
            L.popup().setLatLng(e.latlng).setContent('<small>Punto capturado.</small>').openOn(map);
        });
    }

    // --- 2. LISTENERS ---
    function setupEventListeners() {
        document.querySelectorAll('input[name="inputMode"]').forEach(r => r.addEventListener('change', toggleInputs));
        document.getElementById('btnGps').addEventListener('click', getLocation);
        document.getElementById('btnCalculate').addEventListener('click', calculatePreview);
        document.getElementById('btnAddPoint').addEventListener('click', addPointToList);
        document.getElementById('btnClearAll').addEventListener('click', clearAll);
        document.getElementById('btnExportGeoJSON').addEventListener('click', exportGeoJSON);
        document.getElementById('btnExportKML').addEventListener('click', exportKML);
        
        const fileInput = document.getElementById('fileUpload');
        if(fileInput) fileInput.addEventListener('change', handleFileUpload);
    }

    function toggleInputs() {
        const isGeo = document.getElementById('modeGeo').checked;
        document.getElementById('geoInputs').style.display = isGeo ? 'block' : 'none';
        document.getElementById('gpsSection').style.display = isGeo ? 'block' : 'none';
        document.getElementById('utmInputs').style.display = isGeo ? 'none' : 'block';
    }

    // --- 3. LECTURA DE ARCHIVOS ---
    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            const lines = text.split(/\r\n|\n/);
            let addedCount = 0;

            const uiZone = document.getElementById('zoneInput').value;
            const uiHemiVal = document.getElementById('hemisphereInput').value; 
            const uiHemi = (uiHemiVal === 'N') ? 'north' : 'south';

            lines.forEach(line => {
                line = line.trim();
                if (!line) return;

                let parts;
                if (line.includes(',')) parts = line.split(',');
                else if (line.includes(';')) parts = line.split(';');
                else parts = line.split(/\s+/);

                parts = parts.map(p => p.trim());

                if (parts.length === 2) {
                    const lat = parseFloat(parts[0]);
                    const lon = parseFloat(parts[1]);
                    if (isValidGeo(lat, lon)) {
                        pushPoint(lat, lon, "Imp. Geo");
                        addedCount++;
                    }
                } 
                else if (parts.length === 3) {
                    const label = parts[0]; 
                    const east = parseFloat(parts[1]);
                    const north = parseFloat(parts[2]);

                    if (!isNaN(east) && !isNaN(north)) {
                        try {
                            const projStr = `+proj=utm +zone=${uiZone} +${uiHemi} +datum=WGS84 +units=m +no_defs`;
                            const geo = proj4(projStr, 'EPSG:4326', [east, north]);
                            if (isValidGeo(geo[1], geo[0])) {
                                pushPoint(geo[1], geo[0], `Imp. ${label}`);
                                addedCount++;
                            }
                        } catch(err) { console.error(err); }
                    }
                }
            });

            if (addedCount > 0) {
                polygonLayer.setLatLngs(pointsList);
                document.getElementById('pointCount').innerText = pointsList.length;
                updatePolygonStats();
                map.fitBounds(polygonLayer.getBounds(), {padding: [20, 20]});
                alert(`Importación completada: ${addedCount} puntos.`);
            } else {
                alert("No se encontraron coordenadas válidas.");
            }
            event.target.value = ''; 
        };
        reader.readAsText(file);
    }

    function isValidGeo(lat, lon) {
        return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }

    function pushPoint(lat, lon, label) {
        pointsList.push([lat, lon]);
        const tbody = document.getElementById('pointsTableBody');
        const row = document.createElement('tr');
        row.innerHTML = `<td><strong>${pointsList.length}</strong></td><td>${lat.toFixed(6)}, ${lon.toFixed(6)} <small class='text-muted'>(${label})</small></td>`;
        tbody.appendChild(row);
    }

    // --- 4. CÁLCULO ---
    function calculatePreview() {
        const isGeo = document.getElementById('modeGeo').checked;
        let lat, lon, utmE, utmN, zone, hemi;

        try {
            if (isGeo) {
                lat = parseFloat(document.getElementById('latInput').value);
                lon = parseFloat(document.getElementById('lonInput').value);
                if (isNaN(lat) || isNaN(lon)) throw new Error("Vacío");
                zone = Math.floor((lon + 180) / 6) + 1;
                hemi = lat >= 0 ? 'north' : 'south';
                const utm = proj4('EPSG:4326', `+proj=utm +zone=${zone} +${hemi} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
                utmE = utm[0]; utmN = utm[1];
            } else {
                utmE = parseFloat(document.getElementById('eastInput').value);
                utmN = parseFloat(document.getElementById('northInput').value);
                zone = document.getElementById('zoneInput').value;
                const hVal = document.getElementById('hemisphereInput').value;
                hemi = hVal === 'N' ? 'north' : 'south';
                if (isNaN(utmE) || isNaN(utmN)) throw new Error("Vacío");
                const geo = proj4(`+proj=utm +zone=${zone} +${hemi} +datum=WGS84 +units=m +no_defs`, 'EPSG:4326', [utmE, utmN]);
                lon = geo[0]; lat = geo[1];
            }
            currentCalc = { lat, lon };
            updateResultUI(lat, lon, utmE, utmN, zone, hemi);
            previewMarker.setLatLng([lat, lon]);
            if (!map.getBounds().contains([lat, lon])) map.setView([lat, lon], 16);
        } catch (e) { resetPreview(); }
    }

    function updateResultUI(lat, lon, e, n, z, h) {
        document.getElementById('resDD').innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        document.getElementById('resDMS').innerText = `${toDMS(lat, true)}   ${toDMS(lon, false)}`;
        const hLet = (typeof h === 'string' && h.includes('north')) ? 'N' : 'S';
        document.getElementById('resUTM').innerText = `Z${z}${hLet} E:${e.toFixed(2)} N:${n.toFixed(2)}`;
        const btn = document.getElementById('btnAddPoint');
        btn.disabled = false; btn.className = "btn btn-success w-100";
    }

    function resetPreview() {
        document.getElementById('btnAddPoint').disabled = true;
        document.getElementById('btnAddPoint').className = "btn btn-secondary w-100";
        document.getElementById('resDD').innerText = "---";
        document.getElementById('resDMS').innerText = "---";
        document.getElementById('resUTM').innerText = "---";
    }

    // --- 5. GESTIÓN LISTA ---
    function addPointToList() {
        if (!currentCalc) return;
        pushPoint(currentCalc.lat, currentCalc.lon, "Manual");
        polygonLayer.setLatLngs(pointsList);
        document.getElementById('pointCount').innerText = pointsList.length;
        updatePolygonStats();
        map.closePopup();
        document.getElementById('latInput').value = ""; document.getElementById('lonInput').value = "";
        resetPreview();
    }

    function updatePolygonStats() {
        if (pointsList.length < 3) { infoControl.update(null); return; }
        const coords = pointsList.map(p => [p[1], p[0]]); coords.push(coords[0]);
        const poly = turf.polygon([coords]);
        const area = turf.area(poly);
        const line = turf.polygonToLine(poly);
        const perim = turf.length(line, {units: 'kilometers'}) * 1000;
        infoControl.update({
            area: area.toLocaleString('es-MX', {maximumFractionDigits: 2}),
            has: (area/10000).toLocaleString('es-MX', {maximumFractionDigits: 4}),
            perim: perim.toLocaleString('es-MX', {maximumFractionDigits: 2})
        });
    }

    function clearAll() {
        if(!confirm("¿Borrar todo?")) return;
        pointsList = []; polygonLayer.setLatLngs([]);
        document.getElementById('pointsTableBody').innerHTML = "";
        document.getElementById('pointCount').innerText = "0";
        infoControl.update(null); resetPreview();
    }

    function getLocation() {
        const btn = document.getElementById('btnGps');
        if (navigator.geolocation) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
            navigator.geolocation.getCurrentPosition(pos => {
                document.getElementById('modeGeo').checked = true; toggleInputs();
                document.getElementById('latInput').value = pos.coords.latitude.toFixed(6);
                document.getElementById('lonInput').value = pos.coords.longitude.toFixed(6);
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Listo';
                setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> GPS', 2000);
                calculatePreview(); map.setView([pos.coords.latitude, pos.coords.longitude], 18);
            }, () => alert("Error GPS"), { enableHighAccuracy: true });
        } else alert("No GPS");
    }

    function downloadFile(content, name, type) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([content], { type: type }));
        a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    function exportGeoJSON() {
        if (pointsList.length < 3) return alert("Faltan puntos");
        let coords = pointsList.map(p => [p[1], p[0]]); coords.push(coords[0]); 
        const geo = { "type": "FeatureCollection", "features": [{ "type": "Feature", "properties": {"name":"Poligono"}, "geometry": { "type": "Polygon", "coordinates": [coords] } }] };
        downloadFile(JSON.stringify(geo, null, 2), "poligono.geojson", "application/json");
    }

    function exportKML() {
        if (pointsList.length < 3) return alert("Faltan puntos");
        let s = ""; pointsList.forEach(p => s += `${p[1]},${p[0]},0 `); s += `${pointsList[0][1]},${pointsList[0][0]},0`;
        const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Poligono</name><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>${s}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
        downloadFile(kml, "poligono.kml", "application/vnd.google-earth.kml+xml");
    }

    function toDMS(deg, isLat) {
        const abs = Math.abs(deg); const d = Math.floor(abs); const m = Math.floor((abs - d)*60); const s = (((abs-d)*60 - m)*60).toFixed(2);
        return `${d}° ${m}' ${s}" ${isLat ? (deg>=0?'N':'S') : (deg>=0?'E':'W')}`;
    }
});