// Manejo de tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        tab.classList.add('active');

        const mainTab = document.getElementById(`${tabName}-tab`);
        const faqTab = document.getElementById(`${tabName}-faq`);
        const guideTab = document.getElementById(`${tabName}-guide`);

        if (mainTab) mainTab.classList.add('active');
        if (faqTab) faqTab.classList.add('active');
        if (guideTab) guideTab.classList.add('active');
    });
});

// ========== DRAG & DROP PARA ARCHIVO .TXT ==========
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

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

dropArea.addEventListener('dragenter', (e) => {
    [...e.dataTransfer.items].forEach((item) => {
        if (typeValidation(item.type)) {
            dropArea.classList.add('drag-over-effect');
        }
    });
});

dropArea.addEventListener('dragover', (e) => {
    [...e.dataTransfer.items].forEach((item) => {
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
        const validExtensions = ['.txt', '.xlsx', '.xls'];
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
            
            console.log('Archivo cargado:', file.name);
        } else {
            alert('⚠️ Por favor, arrastra solo archivos .txt, .xlsx o .xls');
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

// ========== DRAG & DROP PARA PLAYLIST/EXCEL ==========
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
            
            console.log('Archivo Excel cargado:', file.name);
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

// ========== UTILIDADES PARA MOSTRAR PROGRESO ==========
function showProgress(message) {
    const container = document.getElementById('progress-container');
    const text = document.getElementById('progress-text');
    
    container.style.display = 'block';
    text.textContent = message;
}

function hideProgress() {
    document.getElementById('progress-container').style.display = 'none';
}

function updateProgress(percent) {
    const fill = document.getElementById('progress-fill');
    fill.style.width = percent + '%';
}

// ========== FUNCIÓN AUXILIAR PARA HACER FETCH CON TIMEOUT ==========
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// ========== FUNCIONES DE DESCARGA ==========

// Descarga individual desde URL (TIMEOUT: 15 minutos)
async function downloadSingle() {
    const url = document.getElementById('single-url').value;
    const audioOnly = document.getElementById('url-audio-only').checked;
    
    if (!url) {
        alert('Por favor ingresa una URL válida');
        return;
    }

    showProgress('Descargando desde URL individual...');
    updateProgress(0);

    const formData = new FormData();
    formData.append("url", url);
    formData.append("format_type", audioOnly ? "mp3" : "mp4");

    try {
        updateProgress(30);
        console.log("Iniciando descarga individual desde:", url);
        
        // 15 minutos para URL individual
        const response = await fetchWithTimeout("/download/", {
            method: "POST",
            body: formData
        }, 15 * 60 * 1000);

        updateProgress(60);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Error en la descarga");
        }

        updateProgress(80);
        
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `video.${audioOnly ? 'mp3' : 'mp4'}`;
        if (contentDisposition) {
            const matches = /filename="?(.+)"?/.exec(contentDisposition);
            if (matches) filename = matches[1];
        }
        
        a.download = filename;
        a.click();
        URL.revokeObjectURL(downloadUrl);

        updateProgress(100);
        
        setTimeout(() => {
            hideProgress();
        }, 500);

    } catch (err) {
        console.error('Error en descarga individual:', err);
        hideProgress();
        
        if (err.name === 'AbortError') {
            alert("La descarga tardó más de 15 minutos. Intenta de nuevo.");
        } else {
            alert("Error al descargar el archivo: " + err.message);
        }
    }
}

// Descarga desde archivo .txt o .xlsx (TIMEOUT: 90 minutos)
async function downloadFromFile() {
    const file = document.getElementById('txt-file').files[0];
    const audioOnly = document.getElementById('file-audio-only').checked;
    
    if (!file) {
        alert('Por favor selecciona un archivo');
        return;
    }
    
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    const message = isExcel 
        ? 'Procesando Excel de Exportify y buscando canciones... (esto puede tardar varios minutos)'
        : 'Procesando y buscando canciones... (esto puede tardar varios minutos)';
    
    showProgress(message);
    updateProgress(10);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("format_type", audioOnly ? "mp3" : "mp4");

    try {
        updateProgress(20);
        console.log("Iniciando descarga de archivo:", file.name);
        
        // 90 minutos para archivo .txt o .xlsx
        const response = await fetchWithTimeout("/download_batch/", {
            method: "POST",
            body: formData
        }, 90 * 60 * 1000);

        updateProgress(70);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Error en la descarga");
        }

        updateProgress(85);
        
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = "batch_download.zip";
        a.click();
        URL.revokeObjectURL(downloadUrl);

        updateProgress(100);
        
        setTimeout(() => {
            hideProgress();
        }, 500);

    } catch (err) {
        console.error('Error en descarga de archivo:', err);
        hideProgress();
        
        if (err.name === 'AbortError') {
            alert("La descarga tardó más de 90 minutos. Intenta de nuevo.");
        } else {
            alert("Error al descargar los archivos: " + err.message);
        }
    }
}

// Descarga de playlist (TIMEOUT: 90 minutos)
async function downloadPlaylist() {
    const url = document.getElementById('playlist-url').value;
    const file = document.getElementById('excel-file').files[0];
    const audioOnly = document.getElementById('playlist-audio-only').checked;
    
    if (!url && !file) {
        alert('Por favor ingresa una URL de playlist o selecciona un archivo Excel');
        return;
    }
    
    showProgress('Descargando playlist completa...');
    updateProgress(0);

    const formData = new FormData();
    
    if (file) {
        formData.append("file", file);
        showProgress('Procesando Excel... esto puede tardar varios minutos');
        console.log("Descargando desde archivo Excel:", file.name);
    } else {
        formData.append("url", url);
        console.log("Descargando playlist desde URL:", url);
    }
    formData.append("format_type", audioOnly ? "mp3" : "mp4");

    const endpoint = file ? "/download_batch/" : "/download_playlist/";

    try {
        updateProgress(20);
        
        // 90 minutos para playlist o Excel
        const response = await fetchWithTimeout(endpoint, {
            method: "POST",
            body: formData
        }, 90 * 60 * 1000);

        updateProgress(60);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Error desconocido" }));
            throw new Error(errorData.error || "Error en la descarga");
        }

        updateProgress(80);
        
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = "playlist_download.zip";
        a.click();
        URL.revokeObjectURL(downloadUrl);

        updateProgress(100);
        
        setTimeout(() => {
            hideProgress();
        }, 500);

    } catch (err) {
        console.error('Error en descarga de playlist:', err);
        hideProgress();
        
        if (err.name === 'AbortError') {
            alert("La descarga tardó más de 90 minutos. Intenta de nuevo.");
        } else {
            alert("Error al descargar la playlist: " + err.message);
        }
    }
}