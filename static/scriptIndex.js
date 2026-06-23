// ================================
// scriptIndex.js - completo
// Version: Final (modo: tareas para archivos + playlists con archivo)
// ================================

// La variable se declara solo aquí para evitar el error de "redeclaration"
let currentFileMode = 'file'; 

document.addEventListener('DOMContentLoaded', () => {
    // -------------------- MANEJO DE TABS (URL, ARCHIVO, PLAYLIST) --------------------
    const tabs = document.querySelectorAll('.tab');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab; // Esto lee "url", "file" o "playlist"

            // 1. Quitar 'active' de todos los botones y contenidos
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // 2. Activar el botón pulsado
            tab.classList.add('active');

            // 3. Activar la sección correspondiente (usando tus IDs: url-tab, file-tab, playlist-tab)
            const targetContent = document.getElementById(target + '-tab');
            if (targetContent) {
                targetContent.classList.add('active');
            }

            // 4. Activar el FAQ correspondiente (url-faq, file-faq, playlist-faq)
            const targetFaq = document.getElementById(target + '-faq');
            if (targetFaq) {
                targetFaq.classList.add('active');
            }
        });
    });
});
// ----------------------------------





function showProgress(message) {
    const container = document.getElementById('progress-container');
    const text = document.getElementById('progress-text');
    container.style.display = 'block';
    text.textContent = message || 'Procesando...';
}

function hideProgress() {
    const container = document.getElementById('progress-container');
    container.style.display = 'none';
}

function updateProgress(percent) {
    const fill = document.getElementById('progress-fill');
    if (!fill) return;
    fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
}

// -------------------- Fetch con timeout util --------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// -------------------- Drag & Drop: archivo .txt/.csv/.xlsx --------------------
const dropArea = document.getElementById('drop-zone');
const fileInput = document.getElementById('txt-file');

function typeValidation(type) {
    const validTypes = [
        'text/plain',
        'text/csv',
        'application/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ];
    return validTypes.includes(type);
}

if (dropArea && fileInput) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    dropArea.addEventListener('dragenter', (e) => {
        [...(e.dataTransfer?.items || [])].forEach((item) => {
            if (typeValidation(item.type)) {
                dropArea.classList.add('drag-over-effect');
            }
        });
    });

    dropArea.addEventListener('dragover', (e) => {
        [...(e.dataTransfer?.items || [])].forEach((item) => {
            if (typeValidation(item.type)) {
                dropArea.classList.add('drag-over-effect');
            }
        });
    });

    dropArea.addEventListener('dragleave', (e) => {
        if (e.target === dropArea || !dropArea.contains(e.relatedTarget)) {
            dropArea.classList.remove('drag-over-effect');
        }
    });

    dropArea.addEventListener('drop', (e) => {
        dropArea.classList.remove('drag-over-effect');

        const files = e.dataTransfer.files;

        if (files.length > 0) {
            const file = files[0];
            const validExtensions = ['.txt', '.xlsx', '.xls', '.csv'];
            const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
            const hasValidType = typeValidation(file.type);

            if (hasValidExtension || hasValidType) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                fileInput.files = dataTransfer.files;

                document.querySelector('.file-name').textContent = file.name;

                dropArea.classList.add('drop-success');
                setTimeout(() => {
                    dropArea.classList.remove('drop-success');
                }, 1000);

                console.log('Archivo cargado (drop):', file.name);
            } else {
                alert('⚠️ Por favor, arrastra solo archivos .txt, .xlsx, .xls o .csv');
                dropArea.classList.add('drop-error');
                setTimeout(() => {
                    dropArea.classList.remove('drop-error');
                }, 1000);
            }
        }
    });

    dropArea.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const fileName = e.target.files[0]?.name || 'Ningún archivo seleccionado';
        document.querySelector('.file-name').textContent = fileName;
    });
}

// -------------------- Drag & Drop: playlist / excel --------------------
const playlistDropArea = document.getElementById('playlist-drop-zone');
const excelFileInput = document.getElementById('excel-file');

function excelTypeValidation(type, filename) {
    const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/plain',
        'text/csv'
    ];
    const validExtensions = ['.xlsx', '.xls', '.csv', '.txt'];
    const hasValidType = validTypes.includes(type);
    const hasValidExtension = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
    return hasValidType || hasValidExtension;
}

if (playlistDropArea && excelFileInput) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        playlistDropArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    playlistDropArea.addEventListener('dragenter', (e) => {
        playlistDropArea.classList.add('drag-over-effect');
    });

    playlistDropArea.addEventListener('dragover', (e) => {
        playlistDropArea.classList.add('drag-over-effect');
    });

    playlistDropArea.addEventListener('dragleave', (e) => {
        if (e.target === playlistDropArea || !playlistDropArea.contains(e.relatedTarget)) {
            playlistDropArea.classList.remove('drag-over-effect');
        }
    });

    playlistDropArea.addEventListener('drop', (e) => {
        playlistDropArea.classList.remove('drag-over-effect');

        const files = e.dataTransfer.files;

        if (files.length > 0) {
            const file = files[0];

            if (excelTypeValidation(file.type, file.name)) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                excelFileInput.files = dataTransfer.files;

                document.querySelector('.file-name-playlist').textContent = file.name;

                playlistDropArea.classList.add('drop-success');
                setTimeout(() => {
                    playlistDropArea.classList.remove('drop-success');
                }, 1000);

                console.log('Archivo Excel cargado (drop):', file.name);
            } else {
                alert('⚠️ Por favor, arrastra solo archivos Excel (.xlsx, .xls, .csv o .txt)');
                playlistDropArea.classList.add('drop-error');
                setTimeout(() => {
                    playlistDropArea.classList.remove('drop-error');
                }, 1000);
            }
        }
    });

    playlistDropArea.addEventListener('click', () => {
        excelFileInput.click();
    });

    excelFileInput.addEventListener('change', (e) => {
        const fileName = e.target.files[0]?.name || 'Ningún archivo Excel seleccionado';
        document.querySelector('.file-name-playlist').textContent = fileName;
    });
}

// -------------------- Utilidades --------------------
function cleanFilename(filename) {
    return filename.replace(/_+$/, '').replace(/[<>:"/\\|?*]/g, '_').trim();
}

// -------------------- Descarga individual --------------------
async function downloadSingle() {
    const input = document.getElementById('single-url').value.trim();
    const audioOnly = document.getElementById('url-audio-only').checked;

    if (!input) {
        alert('Por favor ingresa una URL o el nombre de la canción');
        return;
    }

    showProgress('Descargando (individual)...');
    updateProgress(10);

    const formData = new FormData();
    formData.append('url', input);
    formData.append('format_type', audioOnly ? 'mp3' : 'mp4');

    try {
        const response = await fetchWithTimeout('/download/', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        }, 15 * 60 * 1000); // 15 min timeout

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(txt || 'Error en descarga individual');
        }

        const blob = await response.blob();
        if (blob.size === 0) throw new Error('Archivo vacío recibido');

        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `descarga.${audioOnly ? 'mp3' : 'mp4'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);

        updateProgress(100);
        setTimeout(hideProgress, 800);
    } catch (err) {
        console.error('downloadSingle error:', err);
        alert('Error: ' + (err.message || err));
        hideProgress();
    }
}

// -------------------- DESCARGA MASIVA: archivo TXT/CSV/XLSX o texto directo --------------------
async function downloadFromFile() {
    const audioOnly = document.getElementById('file-audio-only').checked;

    // Determine which mode is active
    const mode = (typeof currentFileMode !== 'undefined') ? currentFileMode : 'file';

    if (mode === 'text') {
        // ---- TEXT MODE: send raw text to new endpoint ----
        const textarea = document.getElementById('songs-textarea');
        const text = textarea ? textarea.value.trim() : '';

        if (!text) {
            alert('Por favor escribe al menos una canción');
            return;
        }

        const lines = text.split('\n').filter(l => l.trim().length > 0);
        if (lines.length === 0) {
            alert('No se detectaron canciones válidas');
            return;
        }

        showProgress(`Enviando ${lines.length} canciones...`);
        updateProgress(5);

        const fd = new FormData();
        fd.append('text', text);
        fd.append('format_type', audioOnly ? 'mp3' : 'mp4');

        try {
            const startRes = await fetch('/download_batch_text/', { method: 'POST', body: fd, credentials: 'include' });

            if (!startRes.ok) {
                const t = await startRes.text();
                throw new Error(t || 'Error iniciando tarea desde texto');
            }

            const data = await startRes.json();
            console.log('Task texto iniciado:', data);
            await pollTaskAndDownload(data.task_id);
        } catch (err) {
            console.error('downloadFromFile(text) error:', err);
            alert('Error: ' + (err.message || err));
            hideProgress();
        }

    } else {
        // ---- FILE MODE: original behavior ----
        const file = document.getElementById('txt-file').files[0];

        if (!file) {
            alert('Por favor selecciona un archivo');
            return;
        }

        showProgress('Subiendo archivo y creando tarea...');
        updateProgress(5);

        const fd = new FormData();
        fd.append('file', file);
        fd.append('format_type', audioOnly ? 'mp3' : 'mp4');

        try {
            const startRes = await fetch('/download_batch_start/', { method: 'POST', body: fd, credentials: 'include' });

            if (!startRes.ok) {
                const t = await startRes.text();
                throw new Error(t || 'Error iniciando task');
            }

            const data = await startRes.json();
            const taskId = data.task_id;
            console.log('Task iniciado:', data);

            await pollTaskAndDownload(taskId);
        } catch (err) {
            console.error('downloadFromFile error:', err);
            alert('Error: ' + (err.message || err));
            hideProgress();
        }
    }
}

// -------------------- DESCARGA PLAYLIST SPOTIFY --------------------
async function downloadSpotifyPlaylist() {
    const url = document.getElementById('spotify-playlist-url').value.trim();
    const audioOnly = document.getElementById('playlist-audio-only').checked;

    if (!url) {
        alert('Por favor pega el link de tu playlist de Spotify');
        return;
    }

    if (!url.includes('spotify.com')) {
        alert('⚠️ El link debe ser de Spotify (open.spotify.com/playlist/...)');
        return;
    }

    showProgress('Conectando con Spotify...');
    updateProgress(5);

    const fd = new FormData();
    fd.append('url', url);
    fd.append('format_type', audioOnly ? 'mp3' : 'mp4');

    try {
        const startRes = await fetch('/download_spotify_playlist/', { method: 'POST', body: fd, credentials: 'include' });

        if (!startRes.ok) {
            const t = await startRes.text();
            throw new Error(t || 'Error iniciando descarga de playlist');
        }

        const data = await startRes.json();
        console.log('Tarea Spotify iniciada:', data);
        await pollTaskAndDownload(data.task_id);
    } catch (err) {
        console.error('downloadSpotifyPlaylist error:', err);
        alert('Error: ' + (err.message || err));
        hideProgress();
    }
}

// -------------------- POLLING COMMON --------------------
async function pollTaskAndDownload(taskId) {
    showProgress('Tarea iniciada. Esperando progreso...');
    updateProgress(5);

    let lastProgress = 0;
    return new Promise(resolve => {
        const interval = setInterval(async () => {
            try {
                const resp = await fetch(`/status/${taskId}`, { credentials: 'include' });
                if (!resp.ok) {
                    console.warn('status fetch no ok', resp.status);
                    return;
                }
                const st = await resp.json();
                const total = st.total || 1;
                const progress = st.progress || 0;
                const pct = Math.round((progress / total) * 100);

                updateProgress(pct);
                showProgress(`Procesando ${progress}/${total} — ${st.current || ''}`);

                if (st.status === 'done' && st.zip_ready === true) {
                    clearInterval(interval);
                    await downloadResultZip(taskId);
                    resolve();
                }

                if (st.status === 'failed' || st.status === 'error') {
                    clearInterval(interval);
                    alert('La tarea falló: ' + (st.message || 'Error desconocido'));
                    hideProgress();
                    resolve();
                }

                if (progress > lastProgress) lastProgress = progress;
            } catch (err) {
                console.error('poll error:', err);
            }
        }, 1000);
    });
}

// -------------------- Descargar resultado (ZIP final) --------------------
async function downloadResultZip(taskId) {
    try {
        const link = document.createElement('a');
        link.href = `/download_result/${taskId}?_auth=1`;  // la cookie se manda automáticamente al ser same-origin
        link.download = 'batch_download.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        updateProgress(100);
        setTimeout(hideProgress, 1200);
    } catch (err) {
        console.error('downloadResultZip error:', err);
        alert('Error descargando ZIP: ' + (err.message || err));
        hideProgress();
    }
}

// -------------------- Exportar funciones globales --------------------
window.downloadSingle = downloadSingle;
window.downloadFromFile = downloadFromFile;
window.downloadSpotifyPlaylist = downloadSpotifyPlaylist;

// setFileMode: controla el toggle "Subir archivo" / "Escribir aquí"
// Se define aquí (no en index.html) para evitar redeclaración de currentFileMode
function setFileMode(mode) {
    currentFileMode = mode;
    document.getElementById('file-mode-upload').style.display = mode === 'file' ? '' : 'none';
    document.getElementById('file-mode-text').style.display   = mode === 'text' ? '' : 'none';
    document.getElementById('btn-mode-file').classList.toggle('active', mode === 'file');
    document.getElementById('btn-mode-text').classList.toggle('active', mode === 'text');
}
window.setFileMode = setFileMode;

// -------------------- PLAYLIST SUB-TABS --------------------
function switchPlaylistSubtab(tab) {
    document.getElementById('playlist-subtab-url').style.display = tab === 'url' ? '' : 'none';
    document.getElementById('playlist-subtab-csv').style.display = tab === 'csv' ? '' : 'none';
    document.getElementById('subtab-url').classList.toggle('active', tab === 'url');
    document.getElementById('subtab-csv').classList.toggle('active', tab === 'csv');
}
window.switchPlaylistSubtab = switchPlaylistSubtab;

// -------------------- DRAG & DROP para CSV --------------------
(function setupCsvDropZone() {
    document.addEventListener('DOMContentLoaded', () => {
        const zone = document.getElementById('csv-drop-zone');
        if (!zone) return;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.csv')) {
                setCsvFile(file);
            } else {
                alert('⚠️ Por favor suelta un archivo .csv');
            }
        });
    });
})();

let _csvFile = null;

function setCsvFile(file) {
    _csvFile = file;
    const label = document.getElementById('csv-filename');
    if (label) label.textContent = `📄 ${file.name}`;
}

function onCsvFileSelected(input) {
    if (input.files && input.files[0]) {
        setCsvFile(input.files[0]);
    }
}
window.onCsvFileSelected = onCsvFileSelected;

// -------------------- DESCARGA DESDE CSV EXPORTIFY --------------------
function parseExportifyCSV(text) {
    // Quitar BOM si existe
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // Parsear header
    const header = splitCSVLine(lines[0]);
    const trackIdx  = header.findIndex(h => h.trim().toLowerCase() === 'track name');
    const artistIdx = header.findIndex(h => h.trim().toLowerCase() === 'artist name(s)');

    if (trackIdx === -1) {
        alert('⚠️ El CSV no tiene columna "Track Name". ¿Es un CSV de Exportify?');
        return [];
    }

    const tracks = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);
        const track  = (cols[trackIdx]  || '').trim();
        const artist = artistIdx !== -1 ? (cols[artistIdx] || '').trim() : '';
        if (track) {
            tracks.push(artist ? `${track} ${artist}` : track);
        }
    }
    return tracks;
}

function splitCSVLine(line) {
    // CSV split respetando comillas
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    result.push(cur);
    return result;
}

async function downloadFromSpotifyCSV() {
    if (!_csvFile) {
        alert('Por favor selecciona o arrastra un archivo CSV primero.');
        return;
    }

    const audioOnly = document.getElementById('csv-audio-only').checked;

    const text = await _csvFile.text();
    const tracks = parseExportifyCSV(text);

    if (tracks.length === 0) {
        alert('No se encontraron canciones en el CSV.');
        return;
    }

    console.log(`🎵 CSV procesado: ${tracks.length} canciones`);

    showProgress(`Enviando ${tracks.length} canciones...`);
    updateProgress(5);

    // Crear un .txt virtual con las canciones y mandarlo al endpoint batch
    const blob = new Blob([tracks.join('\n')], { type: 'text/plain' });
    const virtualFile = new File([blob], 'spotify_export.txt', { type: 'text/plain' });

    const fd = new FormData();
    fd.append('file', virtualFile);
    fd.append('format_type', audioOnly ? 'mp3' : 'mp4');

    try {
        const startRes = await fetch('/download_batch_start/', { method: 'POST', body: fd, credentials: 'include' });
        if (!startRes.ok) {
            const t = await startRes.text();
            throw new Error(t || 'Error iniciando descarga');
        }
        const data = await startRes.json();
        console.log('Tarea CSV iniciada:', data);
        await pollTaskAndDownload(data.task_id);
    } catch (err) {
        console.error('downloadFromSpotifyCSV error:', err);
        alert('Error: ' + (err.message || err));
        hideProgress();
    }
}
window.downloadFromSpotifyCSV = downloadFromSpotifyCSV;

// Fin de script
