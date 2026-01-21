#!/usr/bin/env python3
"""
main.py - Versión mejorada con mejor manejo de errores y debugging
"""

from fastapi import FastAPI, Form, File, UploadFile, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from yt_dlp import YoutubeDL
from io import BytesIO
import os, uuid, shutil, re, openpyxl, time, glob, zipfile, platform, threading, traceback
from typing import Dict, Any
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# ============== IMPORTAR SISTEMA DE AUTH ==============
from auth_system import auth
# ======================================================

# ------------------ CONFIG ------------------
BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(exist_ok=True)
TASKS: Dict[str, Dict[str, Any]] = {}
TASK_LOCK = threading.Lock()
CLEANUP_AFTER = 1000
# --------------------------------------------

os.environ['DISPLAY'] = os.environ.get('DISPLAY', '')
os.environ['SDL_VIDEODRIVER'] = os.environ.get('SDL_VIDEODRIVER', 'dummy')

IS_WINDOWS = platform.system() == 'Windows'
if IS_WINDOWS:
    ffmpeg_dir = os.path.dirname(os.path.abspath(__file__))
    os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')
    os.environ['FFMPEG_BINARY'] = os.path.join(ffmpeg_dir, 'ffmpeg.exe')

YDL_BASE_OPTS = {
    'quiet': True,
    'no_warnings': True,
    'ignoreerrors': True,
    
    # User agent de Android (más difícil de bloquear)
    'user_agent': 'com.google.android.youtube/19.45.38 (Linux; U; Android 14) gzip',
    
    # Headers mínimos
    'http_headers': {
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
    
    # Opciones anti-bloqueo
    'extractor_retries': 5,
    'fragment_retries': 10,
    'retries': 10,
    'file_access_retries': 5,
    'socket_timeout': 30,
    
    # CLAVE: Usar cliente Android que casi nunca bloquea YouTube
    'extractor_args': {
        'youtube': {
            'player_client': ['android', 'web'],
            'player_skip': ['webpage'],
            'skip': ['hls', 'dash'],  # Evitar formatos problemáticos
        }
    },
    
    # Añadir delay para evitar rate limiting
    'sleep_interval': 2,
    'max_sleep_interval': 5,
}

if not IS_WINDOWS:
    YDL_BASE_OPTS['ffmpeg_location'] = '/usr/bin/ffmpeg'

COOKIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
# DESACTIVAR cookies temporalmente para probar
USE_COOKIES = False  # Cambiado a False para probar sin cookies
# USE_COOKIES = os.path.exists(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 100

# Configuración de proxy - PUEDES ACTIVAR ESTO SI CONSIGUES UN PROXY
# Formato: "http://usuario:password@proxy.com:puerto" o "http://proxy.com:puerto"
# Proxies gratuitos: https://free-proxy-list.net/ (busca los que digan "yes" en HTTPS)
PROXY_URL = None
# PROXY_URL = "http://104.207.33.242:80"  # Ejemplo - reemplaza con un proxy válido

if USE_COOKIES and os.path.exists(COOKIES_PATH):
    YDL_BASE_OPTS['cookiefile'] = COOKIES_PATH
    print(f"✅ Cookies encontradas: {COOKIES_PATH}")
else:
    print(f"⚠️ Ejecutando SIN cookies")

if PROXY_URL:
    YDL_BASE_OPTS['proxy'] = PROXY_URL
    print(f"🌐 Usando proxy: {PROXY_URL}")
else:
    print(f"🔓 SIN proxy - conexión directa")

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------ UTILITIES ------------------

def sanitize_filename(filename: str) -> str:
    filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
    if len(filename) > 200:
        filename = filename[:200]
    return filename.strip()

def is_url(text: str) -> bool:
    url_pattern = re.compile(
        r'^https?://'
        r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|localhost|\d{1,3}(?:\.\d{1,3}){3})'
        r'(?::\d+)?'
        r'(?:/?|[/?]\S+)$', re.IGNORECASE)
    return url_pattern.match(text) is not None

def clean_url(url: str) -> str:
    if not url:
        return url
    for token in ['&list=', '&index=', '&start_radio=', '&t=']:
        if token in url:
            url = url.split(token)[0]
    return url.strip()

def process_excel_file(file_content: bytes) -> list:
    try:
        workbook = openpyxl.load_workbook(BytesIO(file_content))
        sheet = workbook.active
        songs = []
        headers = {}
        for col_idx, cell in enumerate(sheet[1], start=1):
            header = str(cell.value).strip().lower() if cell.value else ""
            if 'track name' in header or 'song' in header or 'title' in header:
                headers['track'] = col_idx
            elif 'artist' in header:
                headers['artist'] = col_idx
        if 'track' not in headers:
            return []
        for row_idx in range(2, sheet.max_row + 1):
            track_name = sheet.cell(row=row_idx, column=headers.get('track', 1)).value
            artist_name = sheet.cell(row=row_idx, column=headers.get('artist', 2)).value if 'artist' in headers else ""
            if track_name:
                track_name = str(track_name).strip()
                artist_name = str(artist_name).strip() if artist_name else ""
                query = f"{track_name} {artist_name}".strip()
                songs.append(query)
        return songs
    except Exception as e:
        print("Error procesando Excel:", e)
        return []

import csv
from io import StringIO

def extract_spotify_csv_tracks(csv_lines: list) -> list:
    text = "\n".join(csv_lines)
    try:
        dialect = csv.Sniffer().sniff(text, delimiters=",;")
        delimiter = dialect.delimiter
    except:
        delimiter = ","
    f = StringIO(text)
    reader = csv.DictReader(f, delimiter=delimiter)
    tracks = []
    for row in reader:
        track = row.get("Track Name") or row.get("Name") or row.get("Title")
        artist = row.get("Artist Name(s)") or row.get("Artist") or row.get("Artists")
        if track:
            track = str(track).strip()
            artist = str(artist).strip() if artist else ""
            tracks.append(f"{track} {artist}".strip())
    return tracks

def create_zip_on_disk(folder_path: str, zip_path: str) -> None:
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, folder_path)
                arcname = sanitize_filename(arcname)
                zipf.write(file_path, arcname)

def delayed_cleanup(file_path: str, delay: int = 60):
    time.sleep(delay)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            print("Limpieza: eliminado", file_path)
    except Exception as e:
        print("Error en limpieza:", e)

def search_and_download(query: str, ydl_opts: dict) -> bool:
    """Busca y descarga usando ytsearch - VERSIÓN MEJORADA"""
    try:
        search_url = f"ytsearch1:{query}"
        print(f"🔍 Buscando: {query}")
        
        search_opts = {
            **YDL_BASE_OPTS,
            'quiet': False,
            'no_warnings': False,
            'extract_flat': False,
            'format': 'bestaudio/best',
            'ignoreerrors': True,
        }
        
        # NO usar cookies en búsquedas
        # if USE_COOKIES:
        #     search_opts['cookiefile'] = COOKIES_PATH
        
        with YoutubeDL(search_opts) as ydl:
            search_result = ydl.extract_info(search_url, download=False)
            
        if not search_result:
            print(f"❌ No se encontraron resultados para: {query}")
            return False
            
        if 'entries' not in search_result or not search_result['entries']:
            print(f"❌ No hay entries en el resultado para: {query}")
            return False
        
        for entry in search_result['entries']:
            if entry and entry.get('id'):
                try:
                    video_url = f"https://www.youtube.com/watch?v={entry['id']}"
                    print(f"⬇️ Descargando: {video_url}")
                    
                    download_opts = {**ydl_opts}
                    # NO usar cookies
                    # if USE_COOKIES and 'cookiefile' not in download_opts:
                    #     download_opts['cookiefile'] = COOKIES_PATH
                    
                    with YoutubeDL(download_opts) as ydl_download:
                        ydl_download.download([video_url])
                    
                    print(f"✅ Descarga exitosa: {query}")
                    return True
                    
                except Exception as e:
                    print(f"⚠️ Error descargando {video_url}: {e}")
                    continue
        
        print(f"❌ No se pudo descargar ningún resultado para: {query}")
        return False
        
    except Exception as e:
        print(f"❌ Error en search_and_download para '{query}': {e}")
        traceback.print_exc()
        return False

def run_batch_task(task_id: str, lines: list, format_type: str, batch_folder: str):
    """Ejecuta la tarea de descarga por lotes - VERSIÓN MEJORADA"""
    try:
        print(f"\n{'='*60}")
        print(f"🚀 Iniciando tarea batch: {task_id}")
        print(f"📊 Total de items: {len(lines)}")
        print(f"📂 Carpeta: {batch_folder}")
        print(f"🎵 Formato: {format_type}")
        print(f"{'='*60}\n")
        
        with TASK_LOCK:
            TASKS[task_id].update({
                'status': 'running',
                'started_at': datetime.utcnow().isoformat(),
                'total': len(lines),
                'progress': 0,
                'success': 0,
                'failed': []
            })
        
        ydl_opts_batch = {
            **YDL_BASE_OPTS,
            'outtmpl': os.path.join(batch_folder, '%(title).200s.%(ext)s'),
            'restrictfilenames': True,
            'quiet': False,
            'no_warnings': False,
        }
        
        if USE_COOKIES:
            ydl_opts_batch['cookiefile'] = COOKIES_PATH
        
        if format_type == "mp3":
            ydl_opts_batch.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            })
            print("🎵 Modo: Solo audio (MP3)")
        else:
            ydl_opts_batch.update({
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'merge_output_format': 'mp4',
            })
            print("🎬 Modo: Video (MP4)")
        
        successful_downloads = 0
        failed = []
        total = len(lines)
        
        for idx, line in enumerate(lines, 1):
            try:
                print(f"\n--- Item {idx}/{total} ---")
                
                TASKS[task_id]['progress'] = idx - 1
                TASKS[task_id]['current'] = line
                
                files_before = set(os.listdir(batch_folder))
                
                if is_url(line):
                    url = clean_url(line)
                    print(f"🌐 Procesando URL: {url}")
                    
                    with YoutubeDL(ydl_opts_batch) as ydl:
                        ydl.download([url])
                    
                    files_after = set(os.listdir(batch_folder))
                    new_files = files_after - files_before
                    
                    if new_files:
                        successful_downloads += 1
                        print(f"✅ URL descargada exitosamente")
                    else:
                        failed.append(line)
                        print(f"⚠️ No se detectaron archivos nuevos para URL")
                else:
                    print(f"🔎 Procesando búsqueda: {line}")
                    
                    if search_and_download(line, ydl_opts_batch):
                        files_after = set(os.listdir(batch_folder))
                        new_files = files_after - files_before
                        
                        if new_files:
                            successful_downloads += 1
                            print(f"✅ Búsqueda descargada exitosamente")
                        else:
                            failed.append(line)
                            print(f"⚠️ No se detectaron archivos nuevos para búsqueda")
                    else:
                        failed.append(line)
                        print(f"❌ Fallo en búsqueda")
                
                TASKS[task_id]['success'] = successful_downloads
                
            except Exception as e:
                failed.append(line)
                print(f"❌ Error procesando '{line}': {e}")
                traceback.print_exc()
            finally:
                TASKS[task_id]['progress'] = idx
        
        print(f"\n{'='*60}")
        print(f"📊 RESUMEN DE DESCARGA")
        print(f"✅ Exitosas: {successful_downloads}")
        print(f"❌ Fallidas: {len(failed)}")
        print(f"{'='*60}\n")
        
        TASKS[task_id]['failed'] = failed
        TASKS[task_id]['finished_at'] = datetime.utcnow().isoformat()
        
        if successful_downloads == 0:
            TASKS[task_id]['status'] = 'failed'
            TASKS[task_id]['message'] = 'No se pudo descargar ningún archivo.'
            print("❌ Tarea fallida: sin descargas exitosas")
            try:
                shutil.rmtree(batch_folder)
            except Exception:
                pass
            return
        
        downloaded_files = os.listdir(batch_folder)
        print(f"📁 Archivos en carpeta: {len(downloaded_files)}")
        
        TASKS[task_id]['status'] = 'zipping'
        print("📦 Creando archivo ZIP...")
        
        zip_filename = f"batch_{task_id}.zip"
        zip_path = os.path.join(DOWNLOADS_DIR, zip_filename)
        create_zip_on_disk(batch_folder, zip_path)
        
        TASKS[task_id]['zip_path'] = zip_path
        TASKS[task_id]['status'] = 'done'
        
        print(f"✅ ZIP creado: {zip_path}")
        print(f"📦 Tamaño: {os.path.getsize(zip_path) / 1024 / 1024:.2f} MB")
        
        t = threading.Thread(target=delayed_cleanup, args=(zip_path, CLEANUP_AFTER), daemon=True)
        t.start()
        
        try:
            shutil.rmtree(batch_folder)
            print(f"🗑️ Carpeta temporal eliminada")
        except Exception as e:
            print(f"⚠️ No se pudo eliminar carpeta temporal: {e}")
            
    except Exception as e:
        TASKS[task_id]['status'] = 'failed'
        TASKS[task_id]['message'] = str(e)
        print(f"❌ Error crítico en run_batch_task: {e}")
        traceback.print_exc()

# ==================== ENDPOINTS DE AUTENTICACIÓN ====================

@app.post("/api/validate_code")
def validate_access_code(code: str = Form(...)):
    """Endpoint para validar el código de acceso"""
    result = auth.validate_code(code)
    return JSONResponse(result)

@app.get("/api/admin/codes")
def get_all_codes():
    """Obtiene todos los códigos (para el panel admin)"""
    codes = auth.get_all_codes()
    return JSONResponse({"codes": codes})

@app.post("/api/admin/generate_code")
def generate_new_code(days: int = Form(30), custom_code: str = Form(None)):
    """Genera un nuevo código (para el panel admin)"""
    if custom_code:
        result = auth.create_code(days=days, custom_code=custom_code)
    else:
        result = auth.create_code(days=days)
    return JSONResponse(result)

@app.post("/api/admin/delete_code")
def delete_code(code: str = Form(...)):
    """Elimina un código (para el panel admin)"""
    success = auth.delete_code(code)
    if success:
        return JSONResponse({"success": True, "message": "Código eliminado"})
    else:
        return JSONResponse({"success": False, "message": "No se puede eliminar este código"})

# =====================================================================

# ------------------ ENDPOINTS ORIGINALES ------------------

@app.get("/")
def root():
    index_path = BASE_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"message": "Index no encontrado"})

@app.get("/admin")
def admin_panel():
    """Ruta para el panel de administración"""
    admin_path = BASE_DIR / "admin.html"
    if admin_path.exists():
        return FileResponse(admin_path)
    return JSONResponse({"message": "Panel admin no encontrado"})

@app.post("/download/")
def download_single(url: str = Form(...), format_type: str = Form("mp3")):
    url = clean_url(url)
    output_folder = DOWNLOADS_DIR
    os.makedirs(output_folder, exist_ok=True)
    filename = str(uuid.uuid4())
    
    # Pequeño delay para evitar rate limiting
    time.sleep(0.5)
    
    # Opciones mejoradas con mejor logging
    ydl_opts_download = {
        **YDL_BASE_OPTS,
        'outtmpl': os.path.join(output_folder, f"{filename}.%(ext)s"),
        'quiet': False,
        'no_warnings': False,
        'verbose': False,  # Cambiar a False para menos spam
    }
    
    if USE_COOKIES and os.path.exists(COOKIES_PATH):
        ydl_opts_download['cookiefile'] = COOKIES_PATH
        print(f"🍪 Usando cookies: {COOKIES_PATH}")
    else:
        print(f"🚫 SIN cookies - modo público")
    
    if format_type == "mp3":
        ydl_opts_download.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
        print("🎵 Modo: MP3")
    else:
        ydl_opts_download.update({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'merge_output_format': 'mp4',
        })
        print("🎬 Modo: MP4")
    
    try:
        print(f"\n{'='*60}")
        print(f"📥 Descargando URL: {url}")
        print(f"📁 Carpeta: {output_folder}")
        print(f"🔖 Filename base: {filename}")
        print(f"{'='*60}\n")
        
        # Intentar descargar
        with YoutubeDL(ydl_opts_download) as ydl:
            info = ydl.extract_info(url, download=True)
            
            if not info:
                raise HTTPException(
                    status_code=500, 
                    detail="No se pudo extraer información del video. Verifica que la URL sea válida."
                )
        
        # Buscar archivo descargado
        print(f"\n🔍 Buscando archivos con prefijo: {filename}")
        downloaded_file = None
        for file in os.listdir(output_folder):
            print(f"   - Archivo encontrado: {file}")
            if file.startswith(filename):
                downloaded_file = os.path.join(output_folder, file)
                print(f"✅ Archivo descargado: {downloaded_file}")
                break
        
        if not downloaded_file:
            # Listar todos los archivos para debug
            all_files = os.listdir(output_folder)
            print(f"\n❌ No se encontró archivo con prefijo '{filename}'")
            print(f"📋 Archivos en carpeta ({len(all_files)}):")
            for f in all_files[-10:]:  # Últimos 10
                print(f"   - {f}")
            
            raise HTTPException(
                status_code=500, 
                detail="El archivo no se descargó correctamente. Verifica la URL o intenta con otra."
            )
        
        # Verificar que el archivo no esté vacío
        file_size = os.path.getsize(downloaded_file)
        print(f"📦 Tamaño del archivo: {file_size / 1024 / 1024:.2f} MB")
        
        if file_size == 0:
            raise HTTPException(
                status_code=500,
                detail="El archivo descargado está vacío. El video podría estar protegido o no disponible."
            )
        
        ext = downloaded_file.split('.')[-1]
        simple_filename = f"descarga.{ext}"
        
        print(f"✅ Descarga exitosa: {simple_filename}\n")
        
        # Programar limpieza
        threading.Thread(target=delayed_cleanup, args=(downloaded_file, 60), daemon=True).start()
        
        return FileResponse(
            path=downloaded_file, 
            filename=simple_filename, 
            media_type="application/octet-stream"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"\n❌ ERROR en download_single:")
        print(f"   Tipo: {type(e).__name__}")
        print(f"   Mensaje: {str(e)}")
        traceback.print_exc()
        
        error_detail = str(e)
        if "ERROR: The downloaded file is empty" in error_detail:
            error_detail = "El video no se pudo descargar. Posibles causas: video privado, bloqueado en tu región, o requiere inicio de sesión."
        elif "Video unavailable" in error_detail:
            error_detail = "El video no está disponible."
        elif "This video is private" in error_detail:
            error_detail = "Este video es privado."
        
        raise HTTPException(status_code=500, detail=error_detail)

@app.post("/download_batch_start/")
async def download_batch_start(file: UploadFile = File(...), format_type: str = Form("mp3")):
    content = await file.read()
    if file.filename.endswith('.xlsx') or file.filename.endswith('.xls'):
        lines = process_excel_file(content)
    elif file.filename.endswith('.csv'):
        text = content.decode('utf-8-sig')  
        csv_content = text.strip().split('\n')
        header = csv_content[0]
        header_clean = header.replace("\ufeff", "")
        if "Track Name" in header_clean:
            lines = extract_spotify_csv_tracks(csv_content)
        else:
            lines = [line.strip() for line in csv_content if line.strip()]
    else:
        lines = [line.strip() for line in content.decode('utf-8').strip().split('\n') if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="El archivo está vacío o no se pudieron extraer canciones")
    
    print(f"\n📄 Archivo procesado: {file.filename}")
    print(f"📋 Total de líneas: {len(lines)}")
    print(f"📤 Primeras 5 líneas:")
    for i, line in enumerate(lines[:5], 1):
        print(f"   {i}. {line}")
    
    task_id = str(uuid.uuid4())
    batch_folder = os.path.join(DOWNLOADS_DIR, task_id)
    os.makedirs(batch_folder, exist_ok=True)
    with TASK_LOCK:
        TASKS[task_id] = {
            'status': 'queued',
            'progress': 0,
            'total': len(lines),
            'success': 0,
            'failed': [],
            'zip_path': None,
            'started_at': None,
            'finished_at': None,
            'message': None,
        }
    thread = threading.Thread(target=run_batch_task, args=(task_id, lines, format_type, batch_folder), daemon=True)
    thread.start()
    return {"task_id": task_id, "message": "Tarea iniciada. Consulta /status/{task_id} para seguimiento."}

@app.get("/status/{task_id}")
def get_status(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task_id no encontrado")
    return {
        "task_id": task_id,
        "status": task.get('status'),
        "progress": task.get('progress'),
        "total": task.get('total'),
        "success": task.get('success'),
        "failed_count": len(task.get('failed', [])),
        "failed_preview": task.get('failed', [])[:10],
        "zip_ready": bool(task.get('zip_path')),
        "message": task.get('message'),
        "started_at": task.get('started_at'),
        "finished_at": task.get('finished_at'),
        "current": task.get('current', None),
    }

@app.get("/download_result/{task_id}")
def download_result(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task_id no encontrado")
    if task.get('status') != 'done' or not task.get('zip_path'):
        raise HTTPException(status_code=400, detail="Zip no disponible aún. Revisa /status/{task_id}")
    zip_path = task['zip_path']
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Archivo zip no encontrado (posible limpieza)")
    return FileResponse(path=zip_path, filename="batch_download.zip", media_type="application/zip")

@app.post("/download_playlist/")
def download_playlist(url: str = Form(...), format_type: str = Form("mp3")):
    url = clean_url(url)
    playlist_id = str(uuid.uuid4())
    playlist_folder = os.path.join(DOWNLOADS_DIR, playlist_id)
    os.makedirs(playlist_folder, exist_ok=True)
    ydl_opts_playlist = {
        **YDL_BASE_OPTS,
        'restrictfilenames': True,
    }
    # NO usar cookies
    # if USE_COOKIES:
    #     ydl_opts_playlist['cookiefile'] = COOKIES_PATH
    if format_type == "mp3":
        ydl_opts_playlist.update({
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(playlist_folder, '%(playlist_index)s - %(title).180s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        ydl_opts_playlist.update({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': os.path.join(playlist_folder, '%(playlist_index)s - %(title).180s.%(ext)s'),
            'merge_output_format': 'mp4',
        })
    try:
        with YoutubeDL(ydl_opts_playlist) as ydl:
            ydl.download([url])
        if not os.listdir(playlist_folder):
            shutil.rmtree(playlist_folder)
            raise HTTPException(status_code=500, detail="No se pudo descargar ningún vídeo de la playlist")
        zip_filename = f"playlist_{playlist_id}.zip"
        zip_path = os.path.join(DOWNLOADS_DIR, zip_filename)
        create_zip_on_disk(playlist_folder, zip_path)
        shutil.rmtree(playlist_folder)
        threading.Thread(target=delayed_cleanup, args=(zip_path, CLEANUP_AFTER), daemon=True).start()
        return FileResponse(path=zip_path, filename="playlist_download.zip", media_type="application/zip")
    except Exception as e:
        if os.path.exists(playlist_folder):
            shutil.rmtree(playlist_folder)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)