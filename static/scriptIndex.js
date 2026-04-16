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
    const url = document.getElementById('single-url').value;
    const audioOnly = document.getElementById('url-audio-only').checked;

    if (!url) {
        alert('Por favor ingresa una URL válida');
        return;
    }

    showProgress('Descargando (individual)...');
    updateProgress(10);

    const formData = new FormData();
    formData.append('url', url);
    formData.append('format_type', audioOnly ? 'mp3' : 'mp4');

    try {
        const response = await fetchWithTimeout('/download/', {
            method: 'POST',
            body: formData
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
            const startRes = await fetch('/download_batch_text/', { method: 'POST', body: fd });

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
            const startRes = await fetch('/download_batch_start/', { method: 'POST', body: fd });

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

// -------------------- DESCARGA PLAYLIST --------------------
async function downloadPlaylist() {
    const url = document.getElementById('playlist-url')?.value || '';
    const file = document.getElementById('excel-file').files[0];
    const audioOnly = document.getElementById('playlist-audio-only').checked;

    if (!url && !file) {
        alert('Por favor ingresa una URL de playlist o selecciona un archivo Excel');
        return;
    }

    if (file) {
        showProgress('Subiendo Excel y creando tarea para playlist (batch)...');
        updateProgress(5);

        const fd = new FormData();
        fd.append('file', file);
        fd.append('format_type', audioOnly ? 'mp3' : 'mp4');

        try {
            const startRes = await fetch('/download_batch_start/', { method: 'POST', body: fd });

            if (!startRes.ok) {
                const t = await startRes.text();
                throw new Error(t || 'Error iniciando task para playlist');
            }

            const data = await startRes.json();
            const taskId = data.task_id;
            console.log('Task playlist iniciado:', data);

            await pollTaskAndDownload(taskId);
        } catch (err) {
            console.error('downloadPlaylist(file) error:', err);
            alert('Error: ' + (err.message || err));
            hideProgress();
        }

    } else {
        showProgress('Descargando playlist desde URL (esto puede tardar)...');
        updateProgress(5);

        const fd = new FormData();
        fd.append('url', url);
        fd.append('format_type', audioOnly ? 'mp3' : 'mp4');

        try {
            const resp = await fetchWithTimeout('/download_playlist/', { method: 'POST', body: fd }, 90 * 60 * 1000);
            if (!resp.ok) {
                const t = await resp.text();
                throw new Error(t || 'Error en download_playlist');
            }

            const blob = await resp.blob();
            if (blob.size === 0) throw new Error('ZIP recibido vacío');

            const dlUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = 'playlist_download.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(dlUrl);

            updateProgress(100);
            setTimeout(hideProgress, 800);
        } catch (err) {
            console.error('downloadPlaylist(url) error:', err);
            alert('Error: ' + (err.message || err));
            hideProgress();
        }
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
                const resp = await fetch(`/status/${taskId}`);
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
        link.href = `/download_result/${taskId}`;
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
window.downloadPlaylist = downloadPlaylist;

// Fin de script
