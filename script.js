document.addEventListener('DOMContentLoaded', function() {
    
    // --- VARIABLES ---
    let map, previewMarker, polygonLayer, markersLayer, infoControl;
    let pointsList = []; 
    let currentCalc = null; 
    
    // ESTADOS
    let isFastDrawMode = false;
    let geometryMode = 'polygon'; // 'polygon' o 'point'

    // --- ARRANQUE ---
    initMap();
    setupEventListeners();
    initTutorial();

    // --- 0. TUTORIAL ---
    function initTutorial() {
        const driver = window.driver.js.driver;
        const driverObj = driver({
            showProgress: true, animate: true,
            nextBtnText: 'Siguiente', prevBtnText: 'Atrás', doneBtnText: '¡Listo!',
            steps: [
                { element: '.header-app', popover: { title: 'GeoCalc Pro', description: 'Calculadora y Digitalizador.' } },
                { element: '.leaflet-draw-toolbar', popover: { title: 'Herramientas', description: '1. Lápiz: Dibujo rápido.\n2. Flecha: Deshacer.\n3. <b>Forma:</b> Cambia entre Polígono y Puntos sueltos.' } },
                { element: '#tourStepImport', popover: { title: 'Importar', description: 'Carga coordenadas desde archivo.' } },
                { element: '#tourStepExport', popover: { title: 'Exportar', description: 'Descarga tus datos.' } }
            ]
        });
        document.getElementById('startTourBtn').addEventListener('click', () => driverObj.drive());
        if (!localStorage.getItem('geoCalcTourV4Seen')) {
            setTimeout(() => { driverObj.drive(); localStorage.setItem('geoCalcTourV4Seen', 'true'); }, 1000);
        }
    }

    // --- 1. MAPA ---
    function initMap() {
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'OSM' });
        const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
        const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Topo' });

        map = L.map('map', { scrollWheelZoom: false, layers: [osm] }).setView([16.75, -93.11], 10);

        const overlay = document.getElementById('zoomOverlay');
        document.getElementById('map').addEventListener('wheel', (e) => {
            if (e.ctrlKey) { e.preventDefault(); e.deltaY < 0 ? map.zoomIn() : map.zoomOut(); }
            else { overlay.classList.add('visible'); setTimeout(() => overlay.classList.remove('visible'), 1500); }
        }, { passive: false });

        // CAPAS VECTORIALES
        polygonLayer = L.polygon([], {color: 'blue', fillColor: '#3388ff', fillOpacity: 0.2}).addTo(map);
        markersLayer = L.layerGroup().addTo(map); // Capa para puntos sueltos
        previewMarker = L.marker([0,0], {opacity: 0.6}).addTo(map);

        L.control.layers({ "Calle": osm, "Sat": sat, "Topo": topo }, { "Dibujo": polygonLayer, "Puntos": markersLayer }, { position: 'topright' }).addTo(map);

        // --- BARRA DE HERRAMIENTAS PERSONALIZADA ---
        const DrawControl = L.Control.extend({
            options: { position: 'topleft' }, 
            onAdd: function() {
                const container = L.DomUtil.create('div', 'leaflet-draw-toolbar leaflet-bar');
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                
                // 1. Lápiz (Fast Draw)
                const btnDraw = createBtn(container, '<i class="fa-solid fa-pen-nib"></i>', 'Dibujo Rápido', () => toggleDrawingMode(btnDraw));
                
                // 2. Deshacer
                createBtn(container, '<i class="fa-solid fa-rotate-left"></i>', 'Deshacer último', () => undoLastPoint());

                // 3. Cambiar Modo (Polígono <-> Puntos)
                const btnMode = createBtn(container, '<i class="fa-solid fa-draw-polygon"></i>', 'Cambiar a Puntos/Polígono', () => toggleGeometryMode(btnMode));
                btnMode.id = 'btnGeomMode'; // ID para cambiar icono dinámicamente

                return container;
            }
        });
        map.addControl(new DrawControl());

        // Widget Info
        infoControl = L.control({position: 'bottomleft'});
        infoControl.onAdd = function() { this._div = L.DomUtil.create('div', 'info-stats'); this.update(); return this._div; };
        infoControl.update = function(props) {
            if (geometryMode === 'point') {
                this._div.innerHTML = '<h6>Modo Puntos</h6><span>Conteo: ' + pointsList.length + '</span>';
            } else {
                this._div.innerHTML = '<h6>Polígono</h6>' + (props ? 
                    `<span><b>Área:</b> ${props.area} m²</span><span><b>Has:</b> ${props.has}</span><span><b>Perim:</b> ${props.perim} m</span>` : '<span>Agrega puntos...</span>');
            }
        };
        infoControl.addTo(map);

        // Clic en Mapa
        map.on('click', function(e) {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            document.getElementById('modeGeo').checked = true; toggleInputs();
            document.getElementById('latInput').value = lat.toFixed(6);
            document.getElementById('lonInput').value = lng.toFixed(6);
            calculatePreview(); 

            if (isFastDrawMode) {
                addPointToList(); 
                // Feedback visual pequeño
                const icon = geometryMode === 'polygon' ? 'fa-draw-polygon' : 'fa-map-pin';
                L.popup({closeButton: false, autoClose: true, className: 'fast-popup'})
                    .setLatLng(e.latlng)
                    .setContent(`<span class="text-success"><i class="fa-solid ${icon}"></i></span>`)
                    .openOn(map);
                setTimeout(() => map.closePopup(), 600);
            } else {
                L.popup().setLatLng(e.latlng).setContent('<div class="text-center"><small>Ubicación</small><br><button class="btn btn-sm btn-primary mt-1" onclick="document.getElementById(\'btnAddPoint\').click()">Agregar</button></div>').openOn(map);
            }
        });
    }

    // Helper para botones
    function createBtn(container, html, title, onClick) {
        const btn = L.DomUtil.create('a', '', container);
        btn.innerHTML = html;
        btn.title = title;
        btn.href = "#";
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
        return btn;
    }

    // --- FUNCIONES DE DIBUJO ---
    function toggleDrawingMode(btn) {
        isFastDrawMode = !isFastDrawMode;
        if (isFastDrawMode) {
            btn.classList.add('drawing-active');
            map.getContainer().style.cursor = 'crosshair'; 
        } else {
            btn.classList.remove('drawing-active');
            map.getContainer().style.cursor = ''; 
        }
    }

    function toggleGeometryMode(btn) {
        // Cambiar estado
        geometryMode = (geometryMode === 'polygon') ? 'point' : 'polygon';
        
        // Cambiar icono visualmente
        if (geometryMode === 'polygon') {
            btn.innerHTML = '<i class="fa-solid fa-draw-polygon"></i>';
            btn.title = "Modo: Polígono";
        } else {
            btn.innerHTML = '<i class="fa-solid fa-location-dot"></i>';
            btn.title = "Modo: Puntos";
        }

        // Refrescar mapa con lo que tengamos en la lista
        refreshMapVisuals();
    }

    function refreshMapVisuals() {
        // Limpiar capas visuales
        polygonLayer.setLatLngs([]);
        markersLayer.clearLayers();

        if (geometryMode === 'polygon') {
            // Dibujar polígono
            polygonLayer.setLatLngs(pointsList);
            updateStats(); // Calcula área
        } else {
            // Dibujar marcadores sueltos
            pointsList.forEach(p => {
                L.circleMarker(p, { color: '#d63031', radius: 5, fillOpacity: 1 }).addTo(markersLayer);
            });
            infoControl.update(); // Solo muestra conteo
        }
    }

    function undoLastPoint() {
        if (pointsList.length > 0) {
            pointsList.pop(); 
            rebuildTable();
            refreshMapVisuals();
            
            if(pointsList.length > 0) previewMarker.setLatLng(pointsList[pointsList.length-1]);
            else { resetPreview(); }
        } else alert("Nada para deshacer.");
    }

    // --- LÓGICA CORE ---
    function addPointToList() {
        if (!currentCalc) return;
        pointsList.push([currentCalc.lat, currentCalc.lon]);
        
        // Agregar a la tabla HTML
        const tbody = document.getElementById('pointsTableBody');
        const row = document.createElement('tr');
        row.innerHTML = `<td><strong>${pointsList.length}</strong></td><td>${currentCalc.lat.toFixed(5)}, ${currentCalc.lon.toFixed(5)}</td>`;
        tbody.appendChild(row);
        
        document.getElementById('pointCount').innerText = pointsList.length;
        
        refreshMapVisuals(); // Actualiza mapa según el modo actual
        
        if (!isFastDrawMode) {
            map.closePopup();
            document.getElementById('latInput').value = ""; document.getElementById('lonInput').value = "";
            resetPreview();
        }
    }

    // --- EXPORTACIÓN INTELIGENTE ---
    function exportGeoJSON() {
        if (pointsList.length < 1) return alert("Sin datos");
        
        let feature;
        
        if (geometryMode === 'polygon') {
            if (pointsList.length < 3) return alert("Se requieren 3 puntos para un polígono.");
            let coords = pointsList.map(p => [p[1], p[0]]); coords.push(coords[0]);
            feature = { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [coords] }, "properties": {"tipo": "Polígono"} };
        } else {
            // Exportar como MultiPoint
            let coords = pointsList.map(p => [p[1], p[0]]); // Lon, Lat
            feature = { "type": "Feature", "geometry": { "type": "MultiPoint", "coordinates": coords }, "properties": {"tipo": "Puntos"} };
        }

        const geo = { "type": "FeatureCollection", "features": [feature] };
        download(JSON.stringify(geo, null, 2), "datos.geojson", "application/json");
    }

    function exportKML() {
        if (pointsList.length < 1) return alert("Sin datos");
        
        let kmlBody = "";
        
        if (geometryMode === 'polygon') {
            if (pointsList.length < 3) return alert("Mínimo 3 puntos para polígono.");
            let s = ""; pointsList.forEach(p => s += `${p[1]},${p[0]},0 `); s += `${pointsList[0][1]},${pointsList[0][0]},0`;
            kmlBody = `<Placemark><name>Poligono</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${s}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
        } else {
            // Exportar puntos sueltos
            pointsList.forEach((p, i) => {
                kmlBody += `<Placemark><name>Punto ${i+1}</name><Point><coordinates>${p[1]},${p[0]},0</coordinates></Point></Placemark>`;
            });
        }

        const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${kmlBody}</Document></kml>`;
        download(kml, "datos.kml", "xml");
    }

    // --- (RESTO DE FUNCIONES IGUALES: EventListeners, Imports, CSV, TXT, Utils) ---
    // Solo las copio para mantener el archivo completo y funcional
    
    function setupEventListeners() {
        document.querySelectorAll('input[name="inputMode"]').forEach(r => r.addEventListener('change', toggleInputs));
        document.getElementById('btnGps').addEventListener('click', getLocation);
        document.getElementById('btnCalculate').addEventListener('click', calculatePreview);
        document.getElementById('btnAddPoint').addEventListener('click', addPointToList);
        document.getElementById('btnClearAll').addEventListener('click', clearAll);
        document.getElementById('btnExportGeoJSON').addEventListener('click', exportGeoJSON);
        document.getElementById('btnExportKML').addEventListener('click', exportKML);
        document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
        document.getElementById('btnExportTXT').addEventListener('click', exportTXT);
        document.getElementById('fileUpload').addEventListener('change', handleFileUpload);
    }

    function toggleInputs() {
        const isGeo = document.getElementById('modeGeo').checked;
        document.getElementById('geoInputs').style.display = isGeo ? 'block' : 'none';
        document.getElementById('gpsSection').style.display = isGeo ? 'block' : 'none';
        document.getElementById('utmInputs').style.display = isGeo ? 'none' : 'block';
    }

    function calculatePreview() {
        const isGeo = document.getElementById('modeGeo').checked;
        let lat, lon, e, n, z, h;
        try {
            if (isGeo) {
                lat = parseFloat(document.getElementById('latInput').value);
                lon = parseFloat(document.getElementById('lonInput').value);
                if (isNaN(lat)) throw new Error();
                z = Math.floor((lon + 180) / 6) + 1;
                h = lat >= 0 ? 'north' : 'south';
                const utm = proj4('EPSG:4326', `+proj=utm +zone=${z} +${h} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
                e = utm[0]; n = utm[1];
            } else {
                e = parseFloat(document.getElementById('eastInput').value);
                n = parseFloat(document.getElementById('northInput').value);
                z = document.getElementById('zoneInput').value;
                const hVal = document.getElementById('hemisphereInput').value;
                h = hVal === 'N' ? 'north' : 'south';
                if (isNaN(e)) throw new Error();
                const geo = proj4(`+proj=utm +zone=${z} +${h} +datum=WGS84 +units=m +no_defs`, 'EPSG:4326', [e, n]);
                lon = geo[0]; lat = geo[1];
            }
            currentCalc = { lat, lon };
            document.getElementById('resDD').innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            document.getElementById('resDMS').innerText = toDMS(lat, true) + ' ' + toDMS(lon, false);
            document.getElementById('resUTM').innerText = `Z${z} E:${e.toFixed(2)} N:${n.toFixed(2)}`;
            document.getElementById('btnAddPoint').disabled = false;
            document.getElementById('btnAddPoint').className = "btn btn-success w-100";
            previewMarker.setLatLng([lat, lon]);
            if (!isFastDrawMode && !map.getBounds().contains([lat, lon])) map.setView([lat, lon], 16);
        } catch(err) { resetPreview(); }
    }

    function updateStats() {
        if (pointsList.length < 3) { infoControl.update(null); return; }
        const coords = pointsList.map(p => [p[1], p[0]]); coords.push(coords[0]);
        const poly = turf.polygon([coords]);
        infoControl.update({
            area: turf.area(poly).toLocaleString('es-MX', {maximumFractionDigits: 2}),
            has: (turf.area(poly)/10000).toLocaleString('es-MX', {maximumFractionDigits: 4}),
            perim: (turf.length(turf.polygonToLine(poly), {units:'kilometers'})*1000).toLocaleString('es-MX', {maximumFractionDigits: 2})
        });
    }

    function rebuildTable() {
        const tbody = document.getElementById('pointsTableBody');
        tbody.innerHTML = ""; 
        pointsList.forEach((p, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${index + 1}</strong></td><td>${p[0].toFixed(5)}, ${p[1].toFixed(5)}</td>`;
            tbody.appendChild(row);
        });
    }

    function resetPreview() {
        document.getElementById('btnAddPoint').disabled = true;
        document.getElementById('btnAddPoint').className = "btn btn-secondary w-100";
        ['resDD','resDMS','resUTM'].forEach(id => document.getElementById(id).innerText = "---");
    }

    function clearAll() {
        if(!confirm("¿Borrar todo?")) return;
        pointsList = []; 
        refreshMapVisuals();
        document.getElementById('pointsTableBody').innerHTML = "";
        document.getElementById('pointCount').innerText = "0";
        infoControl.update(null); resetPreview();
    }

    function getLocation() {
        const btn = document.getElementById('btnGps');
        if (navigator.geolocation) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            navigator.geolocation.getCurrentPosition(pos => {
                document.getElementById('modeGeo').checked = true; toggleInputs();
                document.getElementById('latInput').value = pos.coords.latitude.toFixed(6);
                document.getElementById('lonInput').value = pos.coords.longitude.toFixed(6);
                btn.innerHTML = '<i class="fa-solid fa-check"></i>'; setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> GPS', 2000);
                calculatePreview(); map.setView([pos.coords.latitude, pos.coords.longitude], 18);
            }, () => alert("Error GPS"), { enableHighAccuracy: true });
        } else alert("No GPS");
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            const lines = evt.target.result.split(/\r\n|\n/);
            let added = 0;
            const uiZ = document.getElementById('zoneInput').value;
            const uiH = document.getElementById('hemisphereInput').value === 'N' ? 'north' : 'south';
            lines.forEach(l => {
                let parts = l.trim().split(/[,;\s]+/);
                if (parts.length === 2 && isValid(parts[0], parts[1])) {
                    pointsList.push([parseFloat(parts[0]), parseFloat(parts[1])]); added++;
                } else if (parts.length === 3 && !isNaN(parts[1])) {
                    try {
                        const geo = proj4(`+proj=utm +zone=${uiZ} +${uiH} +datum=WGS84 +units=m +no_defs`, 'EPSG:4326', [parseFloat(parts[1]), parseFloat(parts[2])]);
                        if(isValid(geo[1], geo[0])) { pointsList.push([geo[1], geo[0]]); added++; }
                    } catch(er){}
                }
            });
            if (added > 0) {
                rebuildTable(); refreshMapVisuals();
                document.getElementById('pointCount').innerText = pointsList.length;
                map.fitBounds(L.latLngBounds(pointsList)); alert(`Importados ${added} puntos.`);
            } else alert("Sin datos válidos.");
            e.target.value = '';
        };
        reader.readAsText(file);
    }
    function isValid(lat, lon) { return !isNaN(lat) && !isNaN(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180; }

    function download(content, name, type) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([content], { type: type }));
        a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    function getDataArray() {
        return pointsList.map((p, i) => {
            const lat = p[0], lon = p[1];
            const z = Math.floor((lon + 180) / 6) + 1;
            const h = lat >= 0 ? 'north' : 'south';
            const utm = proj4('EPSG:4326', `+proj=utm +zone=${z} +${h} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
            return { id: i+1, lat: lat.toFixed(7), lon: lon.toFixed(7), e: utm[0].toFixed(3), n: utm[1].toFixed(3), z, h: lat>=0?'N':'S' };
        });
    }

    function exportCSV() {
        if (pointsList.length < 1) return alert("Sin datos");
        let txt = "ID,Latitud,Longitud,Este,Norte,Zona,Hemi\n";
        getDataArray().forEach(r => txt += `${r.id},${r.lat},${r.lon},${r.e},${r.n},${r.z},${r.h}\n`);
        download(txt, "datos.csv", "text/csv");
    }

    function exportTXT() {
        if (pointsList.length < 1) return alert("Sin datos");
        let txt = "ID\tLatitud\tLongitud\tEste\tNorte\tZona\tHemi\n";
        getDataArray().forEach(r => txt += `${r.id}\t${r.lat}\t${r.lon}\t${r.e}\t${r.n}\t${r.z}\t${r.h}\n`);
        download(txt, "datos.txt", "text/plain");
    }

    function toDMS(d, isLat) {
        const abs=Math.abs(d), deg=Math.floor(abs), min=Math.floor((abs-deg)*60), sec=(((abs-deg)*60-min)*60).toFixed(2);
        return `${deg}° ${min}' ${sec}" ${isLat?(d>=0?'N':'S'):(d>=0?'E':'W')}`;
    }
});