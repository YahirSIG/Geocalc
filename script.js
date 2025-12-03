document.addEventListener('DOMContentLoaded', function() {
    
    let map, previewMarker, polygonLayer, markersLayer, infoControl;
    let pointsList = []; 
    let currentCalc = null; 
    let isFastDrawMode = false;
    let geometryMode = 'polygon';
    let tempImportData = []; 

    initMap();
    setupEventListeners();
    initTutorial();

    // --- TUTORIAL ---
    function initTutorial() {
        const driver = window.driver.js.driver;
        const driverObj = driver({
            showProgress: true, animate: true,
            nextBtnText: 'Sig', prevBtnText: 'Atrás', doneBtnText: 'Ok',
            steps: [
                { element: '.header-app', popover: { title: 'GeoCalc Pro', description: 'Calculadora y Digitalizador.' } },
                { element: '.leaflet-draw-toolbar', popover: { title: 'Herramientas', description: 'Dibujo, Deshacer, GPS y Fullscreen.' } },
                { element: '#tourStepMode', popover: { title: 'Modos', description: 'Decimal, GMS o UTM.' } },
                { element: '#tourStepImport', popover: { title: 'Importar', description: 'Carga archivos CSV/TXT con el Asistente.' } }
            ]
        });
        document.getElementById('startTourBtn').addEventListener('click', () => driverObj.drive());
        if (!localStorage.getItem('geoCalcTourV10Seen')) { 
            setTimeout(() => { driverObj.drive(); localStorage.setItem('geoCalcTourV10Seen', 'true'); }, 1000);
        }
    }

    // --- MAPA ---
    function initMap() {
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'OSM' });
        const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', maxZoom: 21, maxNativeZoom: 18 });
        const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'Topo' });

        map = L.map('map', { scrollWheelZoom: false, layers: [osm] }).setView([16.75, -93.11], 10);
        
        const overlay = document.getElementById('zoomOverlay');
        document.getElementById('map').addEventListener('wheel', (e) => {
            if (e.ctrlKey) { e.preventDefault(); e.deltaY < 0 ? map.zoomIn() : map.zoomOut(); }
            else { overlay.classList.add('visible'); setTimeout(() => overlay.classList.remove('visible'), 1500); }
        }, { passive: false });

        polygonLayer = L.polygon([], {color: 'blue', fillColor: '#3388ff', fillOpacity: 0.2}).addTo(map);
        markersLayer = L.layerGroup().addTo(map); 
        previewMarker = L.marker([0,0], {opacity: 0.6}).addTo(map);

        L.control.layers({ "Calle": osm, "Sat": sat, "Topo": topo }, { "Dibujo": polygonLayer, "Puntos": markersLayer }, { position: 'topright' }).addTo(map);

        const DrawControl = L.Control.extend({
            options: { position: 'topleft' }, 
            onAdd: function() {
                const c = L.DomUtil.create('div', 'leaflet-draw-toolbar leaflet-bar');
                L.DomEvent.disableClickPropagation(c); L.DomEvent.disableScrollPropagation(c);
                const btnDraw = createBtn(c, '<i class="fa-solid fa-pen-nib"></i>', 'Dibujo', () => toggleDrawingMode(btnDraw));
                createBtn(c, '<i class="fa-solid fa-rotate-left"></i>', 'Deshacer', () => undoLastPoint());
                const btnMode = createBtn(c, '<i class="fa-solid fa-draw-polygon"></i>', 'Modo', () => toggleGeometryMode(btnMode)); btnMode.id = 'btnGeomMode'; 
                const btnGps = createBtn(c, '<i class="fa-solid fa-location-crosshairs"></i>', 'GPS', () => getLocation(btnGps));
                const btnFull = createBtn(c, '<i class="fa-solid fa-expand"></i>', 'Full', () => toggleFullscreen(btnFull));
                return c;
            }
        });
        map.addControl(new DrawControl());
        
        document.addEventListener("fullscreenchange", () => setTimeout(() => { map.invalidateSize(); }, 200));
        document.addEventListener("webkitfullscreenchange", () => setTimeout(() => { map.invalidateSize(); }, 200));

        infoControl = L.control({position: 'bottomleft'});
        infoControl.onAdd = function() { this._div = L.DomUtil.create('div', 'info-stats'); this.update(); return this._div; };
        infoControl.update = function(props) {
            if (geometryMode === 'point') this._div.innerHTML = '<h6>Modo Puntos</h6><span>Conteo: ' + pointsList.length + '</span>';
            else this._div.innerHTML = '<h6>Polígono</h6>' + (props ? `<span><b>Área:</b> ${props.area} m²</span>` : '<span>Agrega puntos...</span>');
        };
        infoControl.addTo(map);

        map.on('click', function(e) {
            const lat = e.latlng.lat, lng = e.latlng.lng;
            document.getElementById('modeGeo').checked = true; toggleInputs();
            document.getElementById('latInput').value = lat.toFixed(6);
            document.getElementById('lonInput').value = lng.toFixed(6);
            calculatePreview(); 
            if (isFastDrawMode) { addPointToList(); }
            else { L.popup().setLatLng(e.latlng).setContent('<div class="text-center"><button class="btn btn-sm btn-primary" onclick="document.getElementById(\'btnAddPoint\').click()">Agregar</button></div>').openOn(map); }
        });
    }

    function createBtn(c, h, t, o) { const b = L.DomUtil.create('a', '', c); b.innerHTML = h; b.title = t; b.href = "#"; b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); o(); }; return b; }

    // --- ASISTENTE DE IMPORTACIÓN ---
    function previewFile(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            const content = evt.target.result;
            const lines = content.split(/\r\n|\n/).filter(line => line.trim() !== '');
            if (lines.length === 0) return alert("Archivo vacío");

            tempImportData = lines.map(line => line.split(/[,\t;]+/).map(item => item.trim()));
            
            // Llenar tabla preview
            const thead = document.getElementById('previewHead'); const tbody = document.getElementById('previewBody');
            thead.innerHTML = ''; tbody.innerHTML = '';
            let maxCols = 0; tempImportData.slice(0, 5).forEach(row => maxCols = Math.max(maxCols, row.length));

            let headRow = '<tr>'; for(let i=0; i<maxCols; i++) headRow += `<th>Col ${i+1}</th>`; headRow += '</tr>';
            thead.innerHTML = headRow;

            tempImportData.slice(0, 5).forEach(row => {
                let r = '<tr>'; for(let i=0; i<maxCols; i++) r += `<td>${row[i] || ''}</td>`; r += '</tr>';
                tbody.innerHTML += r;
            });

            // Llenar Dropdowns
            document.querySelectorAll('.col-select').forEach(dd => {
                dd.innerHTML = '';
                // Opción por defecto (Seleccionar)
                // let defaultOpt = document.createElement('option'); defaultOpt.text = "Seleccionar..."; dd.appendChild(defaultOpt);
                for(let i=0; i<maxCols; i++) {
                    let opt = document.createElement('option'); opt.value = i; opt.text = `Col ${i+1}`; dd.appendChild(opt);
                }
            });

            // Sugerencias por defecto
            if(maxCols >= 2) { 
                if(document.getElementById('mapDecLat')) document.getElementById('mapDecLat').value = 0; 
                if(document.getElementById('mapDecLon')) document.getElementById('mapDecLon').value = 1; 
            }

            new bootstrap.Modal(document.getElementById('importConfigModal')).show();
        };
        reader.readAsText(file); e.target.value = '';
    }

    function updateImportFields() {
        const type = document.getElementById('importType').value;
        document.querySelectorAll('.mapping-section').forEach(el => el.style.display = 'none');
        if (type === 'dec') document.getElementById('mapDec').style.display = 'flex';
        else if (type === 'utm') document.getElementById('mapUtm').style.display = 'flex';
        else if (type === 'gms') document.getElementById('mapGms').style.display = 'flex';
    }

    function executeImport() {
        const type = document.getElementById('importType').value;
        let added = 0;
        const appZone = document.getElementById('zoneInput').value;
        const appHemi = document.getElementById('hemisphereInput').value === 'N' ? 'north' : 'south';

        tempImportData.forEach(row => {
            try {
                let lat, lon;
                if (type === 'dec') {
                    const vl = parseFloat(row[parseInt(document.getElementById('mapDecLat').value)]);
                    const vlo = parseFloat(row[parseInt(document.getElementById('mapDecLon').value)]);
                    if(!isNaN(vl) && !isNaN(vlo)) { lat = vl; lon = vlo; }
                } else if (type === 'utm') {
                    const e = parseFloat(row[parseInt(document.getElementById('mapUtmE').value)]);
                    const n = parseFloat(row[parseInt(document.getElementById('mapUtmN').value)]);
                    let z = document.getElementById('mapUtmZoneFixed').value || appZone;
                    if(!isNaN(e) && !isNaN(n)) {
                        const geo = proj4(`+proj=utm +zone=${z} +${appHemi} +datum=WGS84 +units=m +no_defs`, 'EPSG:4326', [e, n]);
                        lon = geo[0]; lat = geo[1];
                    }
                } else if (type === 'gms') {
                    const getV = (id) => parseFloat(row[parseInt(document.getElementById(id).value)]);
                    const getS = (id) => row[parseInt(document.getElementById(id).value)];
                    let ld=getV('mapGmsLatD'), lm=getV('mapGmsLatM'), ls=getV('mapGmsLatS');
                    let lnd=getV('mapGmsLonD'), lnm=getV('mapGmsLonM'), lns=getV('mapGmsLonS');
                    let lh=getS('mapGmsLatH').toUpperCase(), lnh=getS('mapGmsLonH').toUpperCase();
                    
                    if(!isNaN(ld)) {
                        lat = ld+lm/60+ls/3600; if(lh.includes('S')) lat*=-1;
                        lon = lnd+lnm/60+lns/3600; if(lnh.includes('W')||lnh.includes('O')) lon*=-1;
                    }
                }

                if (lat !== undefined && !isNaN(lat) && Math.abs(lat)<=90 && Math.abs(lon)<=180) {
                    pointsList.push([lat, lon]); added++;
                }
            } catch (err) {}
        });

        if (added > 0) {
            rebuildTable(); refreshMapVisuals(); document.getElementById('pointCount').innerText = pointsList.length;
            map.fitBounds(L.latLngBounds(pointsList));
            bootstrap.Modal.getInstance(document.getElementById('importConfigModal')).hide();
            alert(`Importados: ${added}`);
        } else { alert("Error: No se encontraron datos válidos."); }
    }

    // --- DESCARGA PLANTILLA ---
    function downloadTemplate() {
        const content = `# EJEMPLO DECIMALES\n16.7532, -93.1145\n\n# EJEMPLO UTM\n487500, 1852000\n\n# EJEMPLO GMS (Columnas)\n16, 45, 12.5, N, 93, 10, 30.2, W`;
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], {type:"text/plain"}));
        a.download = "plantilla_geocalc.txt"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // --- (FUNCIONES CORE IGUALES) ---
    function calculatePreview() {
        const isGeo = document.getElementById('modeGeo').checked;
        const isDms = document.getElementById('modeDms').checked;
        let lat, lon, e, n, z, h;
        try {
            if (isGeo) {
                lat = parseFloat(document.getElementById('latInput').value); lon = parseFloat(document.getElementById('lonInput').value);
                if (isNaN(lat)||isNaN(lon)) throw new Error();
            } else if (isDms) {
                let ld = parseFloat(document.getElementById('dmsLatDeg').value)||0, lm = parseFloat(document.getElementById('dmsLatMin').value)||0, ls = parseFloat(document.getElementById('dmsLatSec').value)||0;
                let lnD = parseFloat(document.getElementById('dmsLonDeg').value)||0, lnM = parseFloat(document.getElementById('dmsLonMin').value)||0, lnS = parseFloat(document.getElementById('dmsLonSec').value)||0;
                lat = ld + lm/60 + ls/3600; if(document.getElementById('dmsLatHemi').value==='S') lat*=-1;
                lon = lnD + lnM/60 + lnS/3600; let lH = document.getElementById('dmsLonHemi').value; if(lH==='W'||lH==='O') lon*=-1;
                if(ld>90||lnD>180) throw new Error();
            } else {
                e = parseFloat(document.getElementById('eastInput').value); n = parseFloat(document.getElementById('northInput').value);
                z = document.getElementById('zoneInput').value; h = document.getElementById('hemisphereInput').value==='N'?'north':'south';
                if (isNaN(e)||isNaN(n)) throw new Error();
                const geo = proj4(`+proj=utm +zone=${z} +${h} +datum=WGS84 +units=m +no_defs`, 'EPSG:4326', [e, n]);
                lon = geo[0]; lat = geo[1];
            }
            if(Math.abs(lat)>90||Math.abs(lon)>180) throw new Error();
            
            z = Math.floor((lon+180)/6)+1; h = lat>=0?'north':'south';
            const utm = proj4('EPSG:4326', `+proj=utm +zone=${z} +${h} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
            currentCalc = { lat, lon };
            
            document.getElementById('resDD').innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            document.getElementById('resDMS').innerText = toDMS(lat, true) + ' ' + toDMS(lon, false);
            document.getElementById('resUTM').innerText = `Z${z} E:${utm[0].toFixed(2)} N:${utm[1].toFixed(2)}`;
            document.getElementById('btnAddPoint').disabled = false;
            document.getElementById('btnAddPoint').className = "btn btn-success w-100";
            previewMarker.setLatLng([lat, lon]);
            if (!isFastDrawMode && !map.getBounds().contains([lat, lon])) map.setView([lat, lon], 16);
        } catch(err) { resetPreview(); }
    }

    function addPointToList() {
        if (!currentCalc) return;
        pointsList.push([currentCalc.lat, currentCalc.lon]);
        rebuildTable(); document.getElementById('pointCount').innerText = pointsList.length;
        refreshMapVisuals(); 
        if (!isFastDrawMode) {
            map.closePopup();
            document.querySelectorAll('input[type="number"]').forEach(i => i.value = "");
            resetPreview();
        }
    }

    function rebuildTable() {
        const tbody = document.getElementById('pointsTableBody'); tbody.innerHTML = ""; 
        pointsList.forEach((p, i) => {
            const z = Math.floor((p[1]+180)/6)+1, h = p[0]>=0?'north':'south';
            let utmStr="Err"; try{const u=proj4('EPSG:4326', `+proj=utm +zone=${z} +${h} +datum=WGS84 +units=m +no_defs`, [p[1], p[0]]); utmStr=`Z${z}<br>E:${u[0].toFixed(2)}<br>N:${u[1].toFixed(2)}`;}catch(e){}
            const row = document.createElement('tr');
            row.innerHTML = `<td class="align-middle"><strong>${i+1}</strong></td><td class="align-middle">${p[0].toFixed(6)}<br>${p[1].toFixed(6)}</td><td class="align-middle small text-nowrap">${toDMS(p[0],true)}<br>${toDMS(p[1],false)}</td><td class="align-middle small font-monospace">${utmStr}</td>`;
            tbody.appendChild(row);
        });
        const c = document.querySelector('.table-responsive'); c.scrollTop = c.scrollHeight;
    }

    function toggleInputs() {
        const isGeo = document.getElementById('modeGeo').checked;
        const isDms = document.getElementById('modeDms').checked;
        const isUtm = document.getElementById('modeUtm').checked;
        document.getElementById('geoInputs').style.display = isGeo?'block':'none';
        document.getElementById('dmsInputs').style.display = isDms?'block':'none';
        document.getElementById('utmInputs').style.display = isUtm?'block':'none';
        document.getElementById('gpsSection').style.display = (isGeo||isDms)?'block':'none';
    }

    function toggleDrawingMode(btn) { isFastDrawMode = !isFastDrawMode; btn.classList.toggle('drawing-active'); map.getContainer().style.cursor = isFastDrawMode?'crosshair':''; }
    function toggleGeometryMode(btn) { geometryMode = geometryMode==='polygon'?'point':'polygon'; btn.innerHTML = geometryMode==='polygon'?'<i class="fa-solid fa-draw-polygon"></i>':'<i class="fa-solid fa-location-dot"></i>'; refreshMapVisuals(); }
    
    function toggleFullscreen(btn) {
        const e = document.getElementById('map');
        if (!document.fullscreenElement) { (e.requestFullscreen||e.webkitRequestFullscreen).call(e); btn.innerHTML = '<i class="fa-solid fa-compress"></i>'; } 
        else { (document.exitFullscreen||document.webkitExitFullscreen).call(document); btn.innerHTML = '<i class="fa-solid fa-expand"></i>'; }
    }

    function refreshMapVisuals() {
        polygonLayer.setLatLngs([]); markersLayer.clearLayers();
        if (geometryMode === 'polygon') { polygonLayer.setLatLngs(pointsList); updateStats(); } 
        else { pointsList.forEach(p => L.circleMarker(p, {color:'#d63031', radius:5, fillOpacity:1}).addTo(markersLayer)); infoControl.update(); }
    }

    function undoLastPoint() { if(pointsList.pop()) { rebuildTable(); refreshMapVisuals(); if(pointsList.length) previewMarker.setLatLng(pointsList[pointsList.length-1]); else resetPreview(); } }
    function clearAll() { if(confirm("¿Borrar todo?")) { pointsList=[]; refreshMapVisuals(); rebuildTable(); document.getElementById('pointCount').innerText="0"; infoControl.update(null); resetPreview(); } }
    
    function resetPreview() { document.getElementById('btnAddPoint').disabled=true; document.getElementById('btnAddPoint').className="btn btn-secondary w-100"; ['resDD','resDMS','resUTM'].forEach(id=>document.getElementById(id).innerText="---"); }
    
    function getLocation(btn) {
        const t = btn || document.getElementById('btnGps'); const html = t.innerHTML;
        if(navigator.geolocation) { t.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; navigator.geolocation.getCurrentPosition(p=>{
            document.getElementById('modeGeo').checked=true; toggleInputs();
            document.getElementById('latInput').value=p.coords.latitude.toFixed(6); document.getElementById('lonInput').value=p.coords.longitude.toFixed(6);
            calculatePreview(); map.setView([p.coords.latitude, p.coords.longitude], 18);
            t.innerHTML='<i class="fa-solid fa-check"></i>'; setTimeout(()=>t.innerHTML=html,2000);
        },()=>{alert("Error GPS"); t.innerHTML=html;},{enableHighAccuracy:true}); }
    }

    function updateStats() {
        if (pointsList.length < 3) { infoControl.update(null); return; }
        const coords = pointsList.map(p => [p[1], p[0]]); coords.push(coords[0]); const poly = turf.polygon([coords]);
        infoControl.update({ area: turf.area(poly).toLocaleString('es-MX',{maximumFractionDigits:2}), has: (turf.area(poly)/10000).toLocaleString('es-MX',{maximumFractionDigits:4}) });
    }

    function setupEventListeners() {
        document.querySelectorAll('input[name="inputMode"]').forEach(r => r.addEventListener('change', toggleInputs));
        document.getElementById('btnGps').addEventListener('click', () => getLocation());
        document.getElementById('btnCalculate').addEventListener('click', calculatePreview);
        document.getElementById('btnAddPoint').addEventListener('click', addPointToList);
        document.getElementById('btnClearAll').addEventListener('click', clearAll);
        
        // Listeners Importación
        document.getElementById('fileUpload').addEventListener('change', previewFile);
        document.getElementById('importType').addEventListener('change', updateImportFields);
        document.getElementById('btnExecuteImport').addEventListener('click', executeImport);
        document.getElementById('btnDownloadTemplate').addEventListener('click', downloadTemplate);

        document.getElementById('btnExportGeoJSON').addEventListener('click', ()=>exportData('json'));
        document.getElementById('btnExportKML').addEventListener('click', ()=>exportData('kml'));
        document.getElementById('btnExportCSV').addEventListener('click', ()=>exportData('csv'));
        document.getElementById('btnExportTXT').addEventListener('click', ()=>exportData('txt'));
    }

    function exportData(type) {
        if(pointsList.length<1) return alert("Sin datos");
        if(type==='json') {
            let feat = geometryMode==='polygon' ? 
                {type:"Feature", geometry:{type:"Polygon", coordinates:[[...pointsList.map(p=>[p[1],p[0]]), [pointsList[0][1],pointsList[0][0]]]]}} : 
                {type:"Feature", geometry:{type:"MultiPoint", coordinates:pointsList.map(p=>[p[1],p[0]])}};
            download(JSON.stringify({type:"FeatureCollection", features:[feat]},null,2), "datos.geojson", "application/json");
        } else if(type==='kml') {
            let b = geometryMode==='polygon' ? 
                `<Polygon><outerBoundaryIs><LinearRing><coordinates>${pointsList.map(p=>`${p[1]},${p[0]},0`).join(' ')} ${pointsList[0][1]},${pointsList[0][0]},0</coordinates></LinearRing></outerBoundaryIs></Polygon>` :
                pointsList.map((p,i)=>`<Placemark><name>P${i+1}</name><Point><coordinates>${p[1]},${p[0]},0</coordinates></Point></Placemark>`).join('');
            download(`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${b}</Document></kml>`, "datos.kml", "xml");
        } else {
            let h = type==='csv' ? "ID,Lat,Lon\n" : "ID\tLat\tLon\n";
            let c = pointsList.map((p,i)=>`${i+1}${type==='csv'?',':'\t'}${p[0]},${p[1]}`).join('\n');
            download(h+c, `datos.${type}`, "text/plain");
        }
    }

    function toDMS(d, isLat) {
        const abs=Math.abs(d), deg=Math.floor(abs), min=Math.floor((abs-deg)*60), sec=(((abs-deg)*60-min)*60).toFixed(2);
        return `${deg}° ${min}' ${sec}" ${isLat?(d>=0?'N':'S'):(d>=0?'E':'W')}`;
    }

    function download(content, name, type) {
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type: type }));
        a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
});