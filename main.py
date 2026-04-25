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

from metadata_service import MetadataService
metadata_service = MetadataService()

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

# Ruta secreta del panel admin — cámbiala a lo que quieras, solo tú la sabes
ADMIN_SECRET_PATH = "gx9r2p"
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
USE_COOKIES = False

if USE_COOKIES and os.path.exists(COOKIES_PATH):
    YDL_BASE_OPTS['cookiefile'] = COOKIES_PATH
    print(f"✅ Cookies encontradas: {COOKIES_PATH}")
else:
    print(f"⚠️ Ejecutando SIN cookies")

PROXY_URL = None
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
                        
                        if format_type == "mp3":
                            for new_file in new_files:
                                if new_file.endswith('.mp3'):
                                    try:
                                        file_path = os.path.join(batch_folder, new_file)
                                        info = metadata_service.extract_info_from_filename(line)
                                        metadata = metadata_service.search_metadata(info['title'], info['artist'])
                                        if metadata:
                                            metadata_service.apply_metadata_to_mp3(file_path, metadata)
                                    except:
                                        pass
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
        print(f"📁 Archivos descargados ({len(downloaded_files)}):")
        for f in downloaded_files:
            print(f"   - {f}")
        
        zip_filename = f"batch_{task_id}.zip"
        zip_path = os.path.join(DOWNLOADS_DIR, zip_filename)
        
        print(f"\n📦 Creando ZIP: {zip_path}")
        create_zip_on_disk(batch_folder, zip_path)
        
        zip_size = os.path.getsize(zip_path) / 1024 / 1024
        print(f"✅ ZIP creado: {zip_size:.2f} MB")
        
        shutil.rmtree(batch_folder)
        
        threading.Thread(target=delayed_cleanup, args=(zip_path, CLEANUP_AFTER), daemon=True).start()
        
        with TASK_LOCK:
            TASKS[task_id].update({
                'status': 'done',
                'zip_path': zip_path,
                'message': f'Descarga completada. {successful_downloads}/{total} exitosas.'
            })
        
        print(f"🎉 Tarea {task_id} completada exitosamente")
        
    except Exception as e:
        print(f"❌ ERROR CRÍTICO en tarea {task_id}: {e}")
        traceback.print_exc()
        with TASK_LOCK:
            TASKS[task_id].update({
                'status': 'failed',
                'message': str(e)
            })

# ==================== ENDPOINTS DE AUTENTICACIÓN ====================

@app.post("/api/validate_code")
def validate_access_code(code: str = Form(...)):
    """Validates the access code"""
    result = auth.validate_code(code)
    return JSONResponse(result)

@app.get("/api/admin/codes")
def get_all_codes():
    codes = auth.get_all_codes()
    return JSONResponse({"codes": codes})

@app.post("/api/admin/generate_code")
def generate_new_code(days: int = Form(30), custom_code: str = Form(None)):
    if custom_code:
        result = auth.create_code(days=days, custom_code=custom_code)
    else:
        result = auth.create_code(days=days)
    return JSONResponse(result)

@app.post("/api/admin/delete_code")
def delete_code(code: str = Form(...)):
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

# OLD /admin route is GONE.
# The admin panel is served at a secret path defined by ADMIN_SECRET_PATH.
# Access is only granted if the client has rockola_is_admin in sessionStorage
# (enforced in admin.html itself). The URL is not guessable.
@app.get(f"/{ADMIN_SECRET_PATH}")
def admin_panel():
    """Secret admin panel route — not linked anywhere publicly"""
    admin_path = BASE_DIR / "admin.html"
    if admin_path.exists():
        return FileResponse(admin_path)
    return JSONResponse({"message": "Not found"}, status_code=404)

# Return 404 for anyone trying the old /admin path
@app.get("/admin")
def admin_old():
    raise HTTPException(status_code=404, detail="Not found")

@app.post("/download/")
def download_single(url: str = Form(...), format_type: str = Form("mp3")):
    query = url.strip()
    input_is_url = is_url(query)

    if input_is_url:
        resolved_url = clean_url(query)
    else:
        resolved_url = f"ytsearch1:{query}"

    output_folder = DOWNLOADS_DIR
    os.makedirs(output_folder, exist_ok=True)
    filename = str(uuid.uuid4())

    time.sleep(0.5)

    ydl_opts_download = {
        **YDL_BASE_OPTS,
        'outtmpl': os.path.join(output_folder, f"{filename}.%(ext)s"),
        'quiet': False,
        'no_warnings': False,
        'verbose': False,
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
        if input_is_url:
            print(f"📥 Descargando URL: {resolved_url}")
        else:
            print(f"🔍 Descargando por nombre: '{query}'  →  {resolved_url}")
        print(f"📁 Carpeta: {output_folder}")
        print(f"🔖 Filename base: {filename}")
        print(f"{'='*60}\n")

        video_info = None
        with YoutubeDL(ydl_opts_download) as ydl:
            info = ydl.extract_info(resolved_url, download=True)

            if not info:
                raise HTTPException(status_code=500, detail="No se pudo encontrar o descargar la canción.")

            if 'entries' in info:
                info = info['entries'][0] if info['entries'] else None

            if not info:
                raise HTTPException(status_code=500, detail="No se encontraron resultados para esa búsqueda.")

            video_info = {
                'title': info.get('title', ''),
                'uploader': info.get('uploader', ''),
            }

        print(f"\n🔍 Buscando archivos con prefijo: {filename}")
        downloaded_file = None
        for file in os.listdir(output_folder):
            print(f"   - Archivo encontrado: {file}")
            if file.startswith(filename):
                downloaded_file = os.path.join(output_folder, file)
                print(f"✅ Archivo descargado: {downloaded_file}")
                break
        
        if not downloaded_file:
            all_files = os.listdir(output_folder)
            print(f"\n❌ No se encontró archivo con prefijo '{filename}'")
            print(f"📋 Archivos en carpeta ({len(all_files)}):")
            for f in all_files[-10:]:
                print(f"   - {f}")
            
            raise HTTPException(
                status_code=500, 
                detail="El archivo no se descargó correctamente. Verifica la URL o intenta con otra."
            )
        
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

        if format_type == "mp3" and downloaded_file.endswith('.mp3'):
            try:
                title = video_info.get('title', '') if video_info else ''
                info_extracted = metadata_service.extract_info_from_filename(title)
                
                metadata = metadata_service.search_metadata(
                    info_extracted['title'], 
                    info_extracted['artist']
                )
                
                if metadata:
                    metadata_service.apply_metadata_to_mp3(downloaded_file, metadata)
                    print(f"🎉 Metadatos aplicados")
            except Exception as e:
                print(f"⚠️ Error metadatos: {e}")

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

# NEW: batch start from raw text (no file upload needed)
@app.post("/download_batch_text/")
async def download_batch_text(text: str = Form(...), format_type: str = Form("mp3")):
    lines = [line.strip() for line in text.strip().split('\n') if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="El texto está vacío o no tiene canciones válidas")
    
    print(f"\n📝 Texto recibido directamente")
    print(f"📋 Total de líneas: {len(lines)}")
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
    return {"task_id": task_id, "message": "Tarea iniciada desde texto."}

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

from spotify_scraper import SpotifyClient

def get_spotify_tracks(playlist_url: str) -> list[dict]:
    """Obtiene nombre y artista de cada canción de una playlist pública de Spotify."""
    client = SpotifyClient()
    try:
        playlist = client.get_playlist_info(playlist_url)
        tracks = []
        for track in playlist.get('tracks', []):
            nombre = track.get('name', '').strip()
            artista = ''
            artists = track.get('artists', [])
            if artists:
                artista = artists[0].get('name', '').strip()
            if nombre:
                tracks.append({'title': nombre, 'artist': artista})
            time.sleep(0.6)  # delay entre tracks para evitar rate limiting
        return tracks
    finally:
        client.close()


def run_spotify_task(task_id: str, playlist_url: str, format_type: str, batch_folder: str):
    """Descarga una playlist de Spotify via spotifyscraper + yt-dlp"""
    try:
        print(f"\n{'='*60}")
        print(f"🎵 Iniciando descarga Spotify: {task_id}")
        print(f"🔗 URL: {playlist_url}")
        print(f"📂 Carpeta: {batch_folder}")
        print(f"{'='*60}\n")

        with TASK_LOCK:
            TASKS[task_id].update({
                'status': 'running',
                'message': 'Obteniendo canciones de Spotify...',
                'started_at': datetime.utcnow().isoformat(),
            })

        # 1. Obtener lista de canciones de Spotify
        print("📋 Obteniendo tracks de Spotify...")
        tracks = get_spotify_tracks(playlist_url)

        if not tracks:
            with TASK_LOCK:
                TASKS[task_id].update({
                    'status': 'failed',
                    'message': 'No se encontraron canciones. Verifica que la playlist sea pública.',
                    'finished_at': datetime.utcnow().isoformat(),
                })
            return

        total = len(tracks)
        print(f"✅ {total} canciones encontradas")

        with TASK_LOCK:
            TASKS[task_id].update({
                'total': total,
                'message': f'Descargando {total} canciones...',
            })

        # 2. Descargar cada canción con yt-dlp via ytsearch
        success = 0
        failed = []

        for i, track in enumerate(tracks, 1):
            nombre  = track['title']
            artista = track['artist']
            query   = f"{nombre} {artista}".strip()
            search  = f"ytsearch1:{query}"

            print(f"\n[{i}/{total}] 🔍 Buscando: {query}")

            with TASK_LOCK:
                TASKS[task_id].update({
                    'progress': i,
                    'current': query,
                    'message': f'[{i}/{total}] Descargando: {query}',
                })

            ydl_opts = {
                **YDL_BASE_OPTS,
                'outtmpl': os.path.join(batch_folder, '%(title)s.%(ext)s'),
                'quiet': True,
                'no_warnings': True,
            }

            if USE_COOKIES and os.path.exists(COOKIES_PATH):
                ydl_opts['cookiefile'] = COOKIES_PATH

            if format_type == "mp3":
                ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                })
            else:
                ydl_opts.update({
                    'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                    'merge_output_format': 'mp4',
                })

            try:
                with YoutubeDL(ydl_opts) as ydl:
                    ydl.extract_info(search, download=True)
                success += 1
                print(f"   ✅ OK")
            except Exception as e:
                print(f"   ❌ Error: {e}")
                failed.append(query)

            time.sleep(0.5)  # delay entre descargas

        # 3. Aplicar metadatos
        if format_type == "mp3":
            for fname in os.listdir(batch_folder):
                if fname.endswith('.mp3'):
                    try:
                        fpath = os.path.join(batch_folder, fname)
                        info  = metadata_service.extract_info_from_filename(fname)
                        meta  = metadata_service.search_metadata(info['title'], info['artist'])
                        if meta:
                            metadata_service.apply_metadata_to_mp3(fpath, meta)
                    except Exception:
                        pass

        if success == 0:
            with TASK_LOCK:
                TASKS[task_id].update({
                    'status': 'failed',
                    'message': 'No se pudo descargar ninguna canción.',
                    'finished_at': datetime.utcnow().isoformat(),
                })
            shutil.rmtree(batch_folder, ignore_errors=True)
            return

        # 4. Crear ZIP
        zip_filename = f"spotify_{task_id}.zip"
        zip_path     = os.path.join(DOWNLOADS_DIR, zip_filename)
        create_zip_on_disk(batch_folder, zip_path)
        shutil.rmtree(batch_folder, ignore_errors=True)

        threading.Thread(target=delayed_cleanup, args=(zip_path, CLEANUP_AFTER), daemon=True).start()

        msg = f'Completado: {success}/{total} canciones descargadas.'
        if failed:
            msg += f' No encontradas: {len(failed)}.'

        with TASK_LOCK:
            TASKS[task_id].update({
                'status': 'done',
                'zip_path': zip_path,
                'success': success,
                'total': total,
                'progress': total,
                'failed': failed,
                'message': msg,
                'finished_at': datetime.utcnow().isoformat(),
            })

        print(f"\n🎉 Tarea Spotify {task_id} completada — {success}/{total} canciones")

    except Exception as e:
        print(f"❌ ERROR en run_spotify_task: {e}")
        traceback.print_exc()
        shutil.rmtree(batch_folder, ignore_errors=True)
        with TASK_LOCK:
            TASKS[task_id].update({
                'status': 'failed',
                'message': str(e),
                'finished_at': datetime.utcnow().isoformat(),
            })


@app.post("/download_spotify_playlist/")
async def download_spotify_playlist(url: str = Form(...), format_type: str = Form("mp3")):
    url = url.strip()
    if "spotify.com" not in url:
        raise HTTPException(status_code=400, detail="Por favor ingresa un link válido de Spotify (open.spotify.com/playlist/...)")

    task_id      = str(uuid.uuid4())
    batch_folder = os.path.join(DOWNLOADS_DIR, task_id)
    os.makedirs(batch_folder, exist_ok=True)

    with TASK_LOCK:
        TASKS[task_id] = {
            'status':      'queued',
            'progress':    0,
            'total':       0,
            'success':     0,
            'failed':      [],
            'zip_path':    None,
            'started_at':  None,
            'finished_at': None,
            'message':     'Conectando con Spotify...',
            'current':     None,
        }

    threading.Thread(
        target=run_spotify_task,
        args=(task_id, url, format_type, batch_folder),
        daemon=True
    ).start()

    return {"task_id": task_id, "message": "Tarea Spotify iniciada."}


from tarjetas.app import flashscan_app
app.mount("/tarjetas", flashscan_app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
