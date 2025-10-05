// Manejo de tabs
// Manejo de pestañas (contenido + FAQ + guía de Exportify)
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Quitar clases activas
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Activar la pestaña seleccionada
        tab.classList.add('active');

        // Mostrar los elementos correspondientes
        const mainTab = document.getElementById(`${tabName}-tab`);
        const faqTab = document.getElementById(`${tabName}-faq`);
        const guideTab = document.getElementById(`${tabName}-guide`); // solo existe en playlist

        if (mainTab) mainTab.classList.add('active');
        if (faqTab) faqTab.classList.add('active');
        if (guideTab) guideTab.classList.add('active'); // aparece solo en playlist
    });
});



// ========== DRAG & DROP PARA ARCHIVO .TXT ==========
const dropArea = document.getElementById('drop-zone');
const fileInput = document.getElementById('txt-file');

// Función de validación de tipo (soporta .txt, .xlsx, .xls)
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

// Prevenir comportamiento por defecto
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

// Cuando el archivo entra en la zona
dropArea.addEventListener('dragenter', (e) => {
    [...e.dataTransfer.items].forEach((item) => {
        if (typeValidation(item.type)) {
            dropArea.classList.add('drag-over-effect');
        }
    });
});

// Mientras el archivo está sobre la zona
dropArea.addEventListener('dragover', (e) => {
    [...e.dataTransfer.items].forEach((item) => {
        if (typeValidation(item.type)) {
            dropArea.classList.add('drag-over-effect');
        }
    });
});

// Cuando el archivo sale de la zona
dropArea.addEventListener('dragleave', (e) => {
    if (e.target === dropArea || !dropArea.contains(e.relatedTarget)) {
        dropArea.classList.remove('drag-over-effect');
    }
});

// Cuando se suelta el archivo
dropArea.addEventListener('drop', (e) => {
    dropArea.classList.remove('drag-over-effect');
    
    const files = e.dataTransfer.files;
    
    if (files.length > 0) {
        const file = files[0];
        
        // Validar extensión y tipo MIME
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

// Click para abrir selector de archivos
dropArea.addEventListener('click', () => {
    fileInput.click();
});

// Actualizar nombre cuando se selecciona desde el input
fileInput.addEventListener('change', (e) => {
    const fileName = e.target.files[0]?.name || 'Ningún archivo seleccionado';
    document.querySelector('.file-name').textContent = fileName;
});

// ========== DRAG & DROP PARA PLAYLIST/EXCEL ==========
const playlistDropArea = document.getElementById('playlist-drop-zone');
const excelFileInput = document.getElementById('excel-file');

// Función de validación específica para Excel
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

// Prevenir comportamiento por defecto
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    playlistDropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

// Cuando el archivo entra
playlistDropArea.addEventListener('dragenter', (e) => {
    playlistDropArea.classList.add('drag-over-effect');
});

// Mientras está sobre la zona
playlistDropArea.addEventListener('dragover', (e) => {
    playlistDropArea.classList.add('drag-over-effect');
});

// Cuando sale
playlistDropArea.addEventListener('dragleave', (e) => {
    if (e.target === playlistDropArea || !playlistDropArea.contains(e.relatedTarget)) {
        playlistDropArea.classList.remove('drag-over-effect');
    }
});

// Cuando se suelta
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

// Click para abrir selector
playlistDropArea.addEventListener('click', () => {
    excelFileInput.click();
});

// Actualizar nombre cuando se selecciona
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

// ========== FUNCIONES DE DESCARGA ==========

// Descarga individual desde URL
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
        
        const response = await fetch("http://127.0.0.1:8000/download/", {
            method: "POST",
            body: formData
        });

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
        console.error(err);
        hideProgress();
        alert("Error al descargar el archivo: " + err.message);
    }
}

// Descarga desde archivo .txt o .xlsx
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
        
        const response = await fetch("http://127.0.0.1:8000/download_batch/", {
            method: "POST",
            body: formData
        });

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
        console.error(err);
        hideProgress();
        alert("Error al descargar los archivos: " + err.message);
    }
}

// Descarga de playlist
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
    } else {
        formData.append("url", url);
    }
    formData.append("format_type", audioOnly ? "mp3" : "mp4");

    const endpoint = file ? "http://127.0.0.1:8000/download_batch/" : "http://127.0.0.1:8000/download_playlist/";

    try {
        updateProgress(20);
        
        // Sin timeout para permitir procesos largos
        const response = await fetch(endpoint, {
            method: "POST",
            body: formData
        });

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
        console.error('Error completo:', err);
        hideProgress();
        alert("Error al descargar la playlist: " + err.message);
    }
}