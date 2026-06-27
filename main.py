#!/usr/bin/env python3
"""
main.py - Con autenticación real en el servidor (cookies firmadas)
         El modal del frontend ya NO es la defensa — el backend rechaza
         cualquier descarga si no hay sesión válida.
"""

from fastapi import FastAPI, Form, File, UploadFile, BackgroundTasks, HTTPException, Request, Response, Depends, Cookie
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from yt_dlp import YoutubeDL
from io import BytesIO
import os, uuid, shutil, re, openpyxl, time, glob, zipfile, platform, threading, traceback
from typing import Dict, Any, Optional
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from spotify_scraper import SpotifyClient
from metadata_service import MetadataService
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

# Cargar .env si existe
from pathlib import Path as _Path
_env_file = _Path(__file__).resolve().parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

metadata_service = MetadataService()

BASE_DIR       = Path(__file__).resolve().parent

# ============== IMPORTAR SISTEMA DE AUTH ==============
from auth_system import auth
# ======================================================

# ============== TELEMETRÍA ============================
import json as _json

TELEMETRY_FILE = BASE_DIR / "telemetry.json"
_TELE_LOCK     = threading.Lock()

def _load_logs() -> list:
    try:
        if TELEMETRY_FILE.exists():
            return _json.loads(TELEMETRY_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return []

def _save_logs(logs: list):
    try:
        TELEMETRY_FILE.write_text(_json.dumps(logs, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"⚠️ Error guardando telemetría: {e}")

def log_download(code: str, query: str, fmt: str, dl_type: str, ok: bool):
    """Registra una descarga en el archivo de telemetría."""
    entry = {
        "ts":     datetime.utcnow().isoformat(),
        "code":   code,
        "query":  query[:200] if query else "",
        "format": fmt,
        "type":   dl_type,   # single | batch | playlist | spotify
        "ok":     ok,
    }
    with _TELE_LOCK:
        logs = _load_logs()
        logs.append(entry)
        # Mantener solo los últimos 5000 registros
        if len(logs) > 5000:
            logs = logs[-5000:]
        _save_logs(logs)

def _compute_telemetry() -> dict:
    """Calcula las estadísticas agregadas para el panel admin."""
    from collections import Counter
    logs = _load_logs()
    total      = len(logs)
    mp3_count  = sum(1 for l in logs if l.get("format") == "mp3")
    mp4_count  = sum(1 for l in logs if l.get("format") == "mp4")
    users      = len({l.get("code") for l in logs if l.get("code")})

    song_ctr  = Counter(l.get("query","") for l in logs if l.get("query"))
    code_ctr  = Counter(l.get("code","")  for l in logs if l.get("code"))
    type_ctr  = Counter(l.get("type","")  for l in logs if l.get("type"))

    type_labels = {"single":"Individual","batch":"Batch","playlist":"Playlist YT","spotify":"Spotify"}

    return {
        "total":        total,
        "mp3_count":    mp3_count,
        "mp4_count":    mp4_count,
        "unique_users": users,
        "top_songs":    [{"name":k,"count":v} for k,v in song_ctr.most_common(10)],
        "top_codes":    [{"name":k,"count":v} for k,v in code_ctr.most_common(10)],
        "top_types":    [{"name":type_labels.get(k,k),"count":v} for k,v in type_ctr.most_common()],
        "logs":         logs,
    }
# ======================================================

# ============== SESIONES CON COOKIE FIRMADA ===========
# Carga SESSION_SECRET desde variable de entorno.
# IMPORTANTE: define SESSION_SECRET en tu entorno antes de arrancar,
# por ejemplo:  export SESSION_SECRET="una-frase-larga-y-secreta-aqui"
# Si no la defines, el servidor arranca con un secreto de emergencia
# (INSEGURO en producción — solo para pruebas locales).
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
if not SESSION_SECRET:
    import secrets
    SESSION_SECRET = secrets.token_hex(32)
    print("⚠️  SESSION_SECRET no definida — usando secreto temporal.")
    print("    Define la variable de entorno SESSION_SECRET antes de arrancar.")

_serializer = URLSafeTimedSerializer(SESSION_SECRET)
COOKIE_NAME  = "rockola_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7   # 7 días en segundos


def _make_session_cookie(is_admin: bool, code: str = "") -> str:
    """Crea un token firmado con los datos de sesión."""
    return _serializer.dumps({"authenticated": True, "is_admin": is_admin, "code": code})


def _read_session_cookie(token: str) -> Optional[dict]:
    """
    Lee y verifica el token.
    Retorna el dict si es válido y no expiró, None en caso contrario.
    """
    try:
        return _serializer.loads(token, max_age=COOKIE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


def require_auth(request: Request) -> dict:
    """
    Dependencia de FastAPI: verifica que la petición tenga una cookie de
    sesión válida.  Lanza HTTP 401 si no la tiene o está expirada/corrupta.
    """
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="No autenticado. Por favor inicia sesión primero."
        )
    session = _read_session_cookie(token)
    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Sesión inválida o expirada. Por favor inicia sesión de nuevo."
        )
    return session


def require_admin(session: dict = Depends(require_auth)) -> dict:
    """
    Dependencia de FastAPI: además de autenticación, requiere is_admin=True.
    """
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Acceso denegado — se requiere admin.")
    return session
# ======================================================

# ------------------ CONFIG ------------------
BASE_DIR       = Path(__file__).resolve().parent
DOWNLOADS_DIR  = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(exist_ok=True)

TASKS: Dict[str, Dict[str, Any]] = {}
TASK_LOCK = threading.Lock()
CLEANUP_AFTER = 1000

# Ruta secreta del panel admin — cámbiala a lo que quieras
ADMIN_SECRET_PATH = "gx9r2p"
# --------------------------------------------

os.environ['DISPLAY']       = os.environ.get('DISPLAY', '')
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
    'user_agent': 'com.google.android.youtube/19.45.38 (Linux; U; Android 14) gzip',
    'http_headers': {
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
    'extractor_retries': 5,
    'fragment_retries': 10,
    'retries': 10,
    'file_access_retries': 5,
    'socket_timeout': 30,
    'extractor_args': {
        'youtube': {
            'player_client': ['android', 'web'],
            'player_skip': ['webpage'],
            'skip': ['hls', 'dash'],
        }
    },
    'sleep_interval': 2,
    'max_sleep_interval': 5,
}

if not IS_WINDOWS:
    YDL_BASE_OPTS['ffmpeg_location'] = '/usr/bin/ffmpeg'

COOKIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
USE_COOKIES  = False
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
        sheet    = workbook.active
        songs    = []
        headers  = {}
        for col_idx, cell in enumerate(sheet[1], start=1):
            header = str(cell.value).strip().lower() if cell.value else ""
            if 'track name' in header or 'song' in header or 'title' in header:
                headers['track'] = col_idx
            elif 'artist' in header:
                headers['artist'] = col_idx
        if 'track' not in headers:
            return []
        for row_idx in range(2, sheet.max_row + 1):
            track_name  = sheet.cell(row=row_idx, column=headers.get('track', 1)).value
            artist_name = sheet.cell(row=row_idx, column=headers.get('artist', 2)).value if 'artist' in headers else ""
            if track_name:
                track_name  = str(track_name).strip()
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
        dialect   = csv.Sniffer().sniff(text, delimiters=",;")
        delimiter = dialect.delimiter
    except:
        delimiter = ","
    f      = StringIO(text)
    reader = csv.DictReader(f, delimiter=delimiter)
    tracks = []
    for row in reader:
        track  = row.get("Track Name") or row.get("Name") or row.get("Title")
        artist = row.get("Artist Name(s)") or row.get("Artist") or row.get("Artists")
        if track:
            track  = str(track).strip()
            artist = str(artist).strip() if artist else ""
            tracks.append(f"{track} {artist}".strip())
    return tracks

def create_zip_on_disk(folder_path: str, zip_path: str) -> None:
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname   = os.path.relpath(file_path, folder_path)
                arcname   = sanitize_filename(arcname)
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
    try:
        search_url  = f"ytsearch1:{query}"
        print(f"🔍 Buscando: {query}")
        search_opts = {
            **YDL_BASE_OPTS,
            'quiet':          False,
            'no_warnings':    False,
            'extract_flat':   False,
            'format':         'bestaudio/best',
            'ignoreerrors':   True,
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
                    video_url    = f"https://www.youtube.com/watch?v={entry['id']}"
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
    try:
        print(f"\n{'='*60}")
        print(f"🚀 Iniciando tarea batch: {task_id}")
        print(f"📊 Total de items: {len(lines)}")
        print(f"📂 Carpeta: {batch_folder}")
        print(f"🎵 Formato: {format_type}")
        print(f"{'='*60}\n")

        with TASK_LOCK:
            TASKS[task_id].update({
                'status':     'running',
                'started_at': datetime.utcnow().isoformat(),
                'total':      len(lines),
                'progress':   0,
                'success':    0,
                'failed':     []
            })

        ydl_opts_batch = {
            **YDL_BASE_OPTS,
            'outtmpl':          os.path.join(batch_folder, '%(title).200s.%(ext)s'),
            'restrictfilenames': True,
            'quiet':            False,
            'no_warnings':      False,
        }
        if USE_COOKIES:
            ydl_opts_batch['cookiefile'] = COOKIES_PATH

        if format_type == "mp3":
            ydl_opts_batch.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key':              'FFmpegExtractAudio',
                    'preferredcodec':   'mp3',
                    'preferredquality': '0',
                }],
            })
        else:
            ydl_opts_batch.update({
                'format':              'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'merge_output_format': 'mp4',
            })

        successful_downloads = 0
        failed = []
        total  = len(lines)

        for idx, line in enumerate(lines, 1):
            try:
                print(f"\n--- Item {idx}/{total} ---")
                TASKS[task_id]['progress'] = idx - 1
                TASKS[task_id]['current']  = line

                files_before = set(os.listdir(batch_folder))

                if is_url(line):
                    url = clean_url(line)
                    print(f"🌐 Procesando URL: {url}")
                    with YoutubeDL(ydl_opts_batch) as ydl:
                        ydl.download([url])
                    files_after = set(os.listdir(batch_folder))
                    new_files   = files_after - files_before
                    if new_files:
                        successful_downloads += 1
                        if format_type == "mp3":
                            for new_file in new_files:
                                if new_file.endswith('.mp3'):
                                    try:
                                        file_path = os.path.join(batch_folder, new_file)
                                        info      = metadata_service.extract_info_from_filename(line)
                                        metadata  = metadata_service.search_metadata(info['title'], info['artist'])
                                        if metadata:
                                            metadata_service.apply_metadata_to_mp3(file_path, metadata)
                                    except:
                                        pass
                    else:
                        failed.append(line)
                else:
                    print(f"🔎 Procesando búsqueda: {line}")
                    if search_and_download(line, ydl_opts_batch):
                        files_after = set(os.listdir(batch_folder))
                        new_files   = files_after - files_before
                        if new_files:
                            successful_downloads += 1
                        else:
                            failed.append(line)
                    else:
                        failed.append(line)

                TASKS[task_id]['success'] = successful_downloads

            except Exception as e:
                failed.append(line)
                print(f"❌ Error procesando '{line}': {e}")
                traceback.print_exc()
            finally:
                TASKS[task_id]['progress'] = idx

        TASKS[task_id]['failed']      = failed
        TASKS[task_id]['finished_at'] = datetime.utcnow().isoformat()

        if successful_downloads == 0:
            TASKS[task_id]['status']  = 'failed'
            TASKS[task_id]['message'] = 'No se pudo descargar ningún archivo.'
            try:
                shutil.rmtree(batch_folder)
            except Exception:
                pass
            return

        zip_filename = f"batch_{task_id}.zip"
        zip_path     = os.path.join(DOWNLOADS_DIR, zip_filename)
        create_zip_on_disk(batch_folder, zip_path)
        shutil.rmtree(batch_folder)
        threading.Thread(target=delayed_cleanup, args=(zip_path, CLEANUP_AFTER), daemon=True).start()

        with TASK_LOCK:
            TASKS[task_id].update({
                'status':   'done',
                'zip_path': zip_path,
                'message':  f'Descarga completada. {successful_downloads}/{total} exitosas.'
            })

    except Exception as e:
        print(f"❌ ERROR CRÍTICO en tarea {task_id}: {e}")
        traceback.print_exc()
        with TASK_LOCK:
            TASKS[task_id].update({'status': 'failed', 'message': str(e)})


# ==================== ENDPOINTS DE AUTENTICACIÓN ====================

@app.post("/api/validate_code")
def validate_access_code(request: Request, code: str = Form(...)):
    result = auth.validate_code(code)
    json_response = JSONResponse(result)
    if result.get("valid"):
        is_admin = result.get("is_admin", False)
        token    = _make_session_cookie(is_admin, code=code)
        json_response.set_cookie(
            key      = COOKIE_NAME,
            value    = token,
            httponly = True,
            samesite = "none" if False else "lax",
            secure   = False,
            max_age  = COOKIE_MAX_AGE,
            path     = "/",
        )
    return json_response


@app.post("/api/logout")
def logout(response: Response):
    """Elimina la cookie de sesión del navegador."""
    response.delete_cookie(COOKIE_NAME)
    return JSONResponse({"success": True})


@app.get("/api/me")
def me(session: dict = Depends(require_auth)):
    print(f"🔍 SESSION DATA: {session}")  # ← agrega esto
    """
    Endpoint para que el frontend compruebe si la sesión sigue activa.
    Útil al recargar la página para no mostrar el modal innecesariamente.
    """
    return JSONResponse({
        "authenticated": True,
        "is_admin": session.get("is_admin", False),
    })


# --- Endpoints del panel admin protegidos con require_admin ---

@app.get("/api/admin/codes")
def get_all_codes(session: dict = Depends(require_admin)):
    codes = auth.get_all_codes()
    return JSONResponse({"codes": codes})

@app.post("/api/admin/generate_code")
def generate_new_code(
    days: int = Form(30),
    custom_code: str = Form(None),
    session: dict = Depends(require_admin),
):
    if custom_code:
        result = auth.create_code(days=days, custom_code=custom_code)
    else:
        result = auth.create_code(days=days)
    return JSONResponse(result)

@app.post("/api/admin/delete_code")
def delete_code(code: str = Form(...), session: dict = Depends(require_admin)):
    success = auth.delete_code(code)
    if success:
        return JSONResponse({"success": True,  "message": "Código eliminado"})
    else:
        return JSONResponse({"success": False, "message": "No se puede eliminar este código"})

@app.get("/api/admin/telemetry")
def get_telemetry(session: dict = Depends(require_admin)):
    return JSONResponse(_compute_telemetry())

@app.post("/api/admin/telemetry/clear")
def clear_telemetry(session: dict = Depends(require_admin)):
    with _TELE_LOCK:
        _save_logs([])
    return JSONResponse({"success": True})

# =====================================================================

# ------------------ PÁGINAS ------------------

@app.get("/")
def root():
    index_path = BASE_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"message": "Index no encontrado"})

@app.get(f"/{ADMIN_SECRET_PATH}")
def admin_panel():
    admin_path = BASE_DIR / "admin.html"
    if admin_path.exists():
        return FileResponse(admin_path)
    return JSONResponse({"message": "Not found"}, status_code=404)

@app.get("/admin")
def admin_old():
    raise HTTPException(status_code=404, detail="Not found")


# ------------------ ENDPOINTS DE DESCARGA (todos protegidos) ------------------

@app.post("/download/")
def download_single(
    request: Request,
    url: str         = Form(...),
    format_type: str = Form("mp3"),
    _session: dict   = Depends(require_auth),
):
    code  = _session.get("code", "unknown")
    query = url.strip()
    input_is_url = is_url(query)
    resolved_url = clean_url(query) if input_is_url else f"ytsearch1:{query}"

    output_folder = DOWNLOADS_DIR
    os.makedirs(output_folder, exist_ok=True)
    filename = str(uuid.uuid4())
    time.sleep(0.5)

    ydl_opts_download = {
        **YDL_BASE_OPTS,
        'outtmpl':       os.path.join(output_folder, f"{filename}.%(ext)s"),
        'quiet':         False,
        'no_warnings':   False,
        'verbose':       False,
    }
    if USE_COOKIES and os.path.exists(COOKIES_PATH):
        ydl_opts_download['cookiefile'] = COOKIES_PATH

    if format_type == "mp3":
        ydl_opts_download.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key':              'FFmpegExtractAudio',
                'preferredcodec':   'mp3',
                'preferredquality': '0',
            }],
        })
    else:
        ydl_opts_download.update({
            'format':              'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'merge_output_format': 'mp4',
        })

    try:
        video_info = None
        with YoutubeDL(ydl_opts_download) as ydl:
            info = ydl.extract_info(resolved_url, download=True)
            if not info:
                raise HTTPException(status_code=500, detail="No se pudo encontrar o descargar la canción.")
            if 'entries' in info:
                info = info['entries'][0] if info['entries'] else None
            if not info:
                raise HTTPException(status_code=500, detail="No se encontraron resultados.")
            video_info = {'title': info.get('title', ''), 'uploader': info.get('uploader', '')}

        downloaded_file = None
        for file in os.listdir(output_folder):
            if file.startswith(filename):
                downloaded_file = os.path.join(output_folder, file)
                break

        if not downloaded_file:
            raise HTTPException(status_code=500, detail="El archivo no se descargó correctamente.")

        if os.path.getsize(downloaded_file) == 0:
            raise HTTPException(status_code=500, detail="El archivo descargado está vacío.")

        ext             = downloaded_file.split('.')[-1]
        simple_filename = f"descarga.{ext}"

        if format_type == "mp3" and downloaded_file.endswith('.mp3'):
            try:
                title         = video_info.get('title', '') if video_info else ''
                info_extracted = metadata_service.extract_info_from_filename(title)
                metadata      = metadata_service.search_metadata(info_extracted['title'], info_extracted['artist'])
                if metadata:
                    metadata_service.apply_metadata_to_mp3(downloaded_file, metadata)
            except Exception as e:
                print(f"⚠️ Error metadatos: {e}")

        threading.Thread(target=delayed_cleanup, args=(downloaded_file, 60), daemon=True).start()
        log_download(_session.get("code","?"), query, format_type, "single", True)
        return FileResponse(path=downloaded_file, filename=simple_filename, media_type="application/octet-stream")

    except HTTPException:
        log_download(_session.get("code","?"), query, format_type, "single", False)
        raise
    except Exception as e:
        traceback.print_exc()
        error_detail = str(e)
        if "empty" in error_detail.lower():
            error_detail = "El video no se pudo descargar."
        elif "unavailable" in error_detail.lower():
            error_detail = "El video no está disponible."
        raise HTTPException(status_code=500, detail=error_detail)


@app.post("/download_batch_start/")
async def download_batch_start(
    request: Request,
    file: UploadFile  = File(...),
    format_type: str  = Form("mp3"),
    _session: dict    = Depends(require_auth),
):
    content = await file.read()
    if file.filename.endswith('.xlsx') or file.filename.endswith('.xls'):
        lines = process_excel_file(content)
    elif file.filename.endswith('.csv'):
        text        = content.decode('utf-8-sig')
        csv_content = text.strip().split('\n')
        header      = csv_content[0].replace("\ufeff", "")
        if "Track Name" in header:
            lines = extract_spotify_csv_tracks(csv_content)
        else:
            lines = [line.strip() for line in csv_content if line.strip()]
    else:
        lines = [line.strip() for line in content.decode('utf-8').strip().split('\n') if line.strip()]

    if not lines:
        raise HTTPException(status_code=400, detail="El archivo está vacío o no se pudieron extraer canciones")

    task_id      = str(uuid.uuid4())
    batch_folder = os.path.join(DOWNLOADS_DIR, task_id)
    os.makedirs(batch_folder, exist_ok=True)

    with TASK_LOCK:
        TASKS[task_id] = {
            'status': 'queued', 'progress': 0, 'total': len(lines),
            'success': 0, 'failed': [], 'zip_path': None,
            'started_at': None, 'finished_at': None, 'message': None,
        }

    threading.Thread(target=run_batch_task, args=(task_id, lines, format_type, batch_folder), daemon=True).start()
    log_download(_session.get("code","?"), f"[batch:{len(lines)} canciones]", format_type, "batch", True)
    return {"task_id": task_id, "message": "Tarea iniciada."}


@app.post("/download_batch_text/")
async def download_batch_text(
    request: Request,
    text: str        = Form(...),
    format_type: str = Form("mp3"),
    _session: dict   = Depends(require_auth),
):
    lines = [line.strip() for line in text.strip().split('\n') if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="El texto está vacío o no tiene canciones válidas")

    task_id      = str(uuid.uuid4())
    batch_folder = os.path.join(DOWNLOADS_DIR, task_id)
    os.makedirs(batch_folder, exist_ok=True)

    with TASK_LOCK:
        TASKS[task_id] = {
            'status': 'queued', 'progress': 0, 'total': len(lines),
            'success': 0, 'failed': [], 'zip_path': None,
            'started_at': None, 'finished_at': None, 'message': None,
        }

    threading.Thread(target=run_batch_task, args=(task_id, lines, format_type, batch_folder), daemon=True).start()
    log_download(_session.get("code","?"), f"[texto:{len(lines)} canciones]", format_type, "batch", True)
    return {"task_id": task_id, "message": "Tarea iniciada desde texto."}


@app.get("/status/{task_id}")
def get_status(task_id: str, _session: dict = Depends(require_auth)):   # 🔒
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task_id no encontrado")
    return {
        "task_id":       task_id,
        "status":        task.get('status'),
        "progress":      task.get('progress'),
        "total":         task.get('total'),
        "success":       task.get('success'),
        "failed_count":  len(task.get('failed', [])),
        "failed_preview": task.get('failed', [])[:10],
        "zip_ready":     bool(task.get('zip_path')),
        "message":       task.get('message'),
        "started_at":    task.get('started_at'),
        "finished_at":   task.get('finished_at'),
        "current":       task.get('current', None),
    }


@app.get("/download_result/{task_id}")
def download_result(task_id: str, _session: dict = Depends(require_auth)):   # 🔒
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task_id no encontrado")
    if task.get('status') != 'done' or not task.get('zip_path'):
        raise HTTPException(status_code=400, detail="Zip no disponible aún.")
    zip_path = task['zip_path']
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Archivo zip no encontrado")
    return FileResponse(path=zip_path, filename="batch_download.zip", media_type="application/zip")


@app.post("/download_playlist/")
def download_playlist(
    request: Request,
    url: str         = Form(...),
    format_type: str = Form("mp3"),
    _session: dict   = Depends(require_auth),
):
    url          = clean_url(url)
    playlist_id  = str(uuid.uuid4())
    playlist_folder = os.path.join(DOWNLOADS_DIR, playlist_id)
    os.makedirs(playlist_folder, exist_ok=True)

    ydl_opts_playlist = {**YDL_BASE_OPTS, 'restrictfilenames': True}
    if format_type == "mp3":
        ydl_opts_playlist.update({
            'format':  'bestaudio/best',
            'outtmpl': os.path.join(playlist_folder, '%(playlist_index)s - %(title).180s.%(ext)s'),
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '0'}],
        })
    else:
        ydl_opts_playlist.update({
            'format':              'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl':             os.path.join(playlist_folder, '%(playlist_index)s - %(title).180s.%(ext)s'),
            'merge_output_format': 'mp4',
        })

    try:
        with YoutubeDL(ydl_opts_playlist) as ydl:
            ydl.download([url])
        if not os.listdir(playlist_folder):
            shutil.rmtree(playlist_folder)
            raise HTTPException(status_code=500, detail="No se pudo descargar ningún vídeo de la playlist")

        zip_filename = f"playlist_{playlist_id}.zip"
        zip_path     = os.path.join(DOWNLOADS_DIR, zip_filename)
        create_zip_on_disk(playlist_folder, zip_path)
        shutil.rmtree(playlist_folder)
        threading.Thread(target=delayed_cleanup, args=(zip_path, CLEANUP_AFTER), daemon=True).start()
        log_download(_session.get("code","?"), url, format_type, "playlist", True)
        return FileResponse(path=zip_path, filename="playlist_download.zip", media_type="application/zip")
    except Exception as e:
        if os.path.exists(playlist_folder):
            shutil.rmtree(playlist_folder)
        raise HTTPException(status_code=500, detail=str(e))


from spotify_scraper import SpotifyClient

def get_spotify_tracks(playlist_url: str) -> list[dict]:
    client = SpotifyClient()
    try:
        playlist = client.get_playlist_info(playlist_url)
        tracks   = []
        for track in playlist.get("tracks", []):
            nombre  = track.get("name", "").strip()
            artista = ""
            artists = track.get("artists", [])
            if artists:
                artista = artists[0].get("name", "").strip()
            if nombre:
                tracks.append({"title": nombre, "artist": artista})
            time.sleep(0.6)
        return tracks
    finally:
        client.close()


def run_spotify_task(task_id: str, playlist_url: str, format_type: str, batch_folder: str):
    try:
        with TASK_LOCK:
            TASKS[task_id].update({
                'status':     'running',
                'message':    'Obteniendo canciones de Spotify...',
                'started_at': datetime.utcnow().isoformat(),
            })

        tracks = get_spotify_tracks(playlist_url)
        if not tracks:
            with TASK_LOCK:
                TASKS[task_id].update({
                    'status':      'failed',
                    'message':     'No se encontraron canciones.',
                    'finished_at': datetime.utcnow().isoformat(),
                })
            return

        total = len(tracks)
        with TASK_LOCK:
            TASKS[task_id].update({'total': total, 'message': f'Descargando {total} canciones...'})

        success = 0
        failed  = []

        for i, track in enumerate(tracks, 1):
            nombre  = track['title']
            artista = track['artist']
            query   = f"{nombre} {artista}".strip()
            search  = f"ytsearch1:{query}"

            with TASK_LOCK:
                TASKS[task_id].update({'progress': i, 'current': query, 'message': f'[{i}/{total}] Descargando: {query}'})

            ydl_opts = {
                **YDL_BASE_OPTS,
                'outtmpl':     os.path.join(batch_folder, '%(title)s.%(ext)s'),
                'quiet':       True,
                'no_warnings': True,
            }
            if USE_COOKIES and os.path.exists(COOKIES_PATH):
                ydl_opts['cookiefile'] = COOKIES_PATH

            if format_type == "mp3":
                ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '0'}],
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
            except Exception as e:
                print(f" ❌ Error: {e}")
                failed.append(query)

            time.sleep(0.5)

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
                TASKS[task_id].update({'status': 'failed', 'message': 'No se pudo descargar ninguna canción.', 'finished_at': datetime.utcnow().isoformat()})
            shutil.rmtree(batch_folder, ignore_errors=True)
            return

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
                'status': 'done', 'zip_path': zip_path, 'success': success,
                'total': total, 'progress': total, 'failed': failed,
                'message': msg, 'finished_at': datetime.utcnow().isoformat(),
            })

    except Exception as e:
        print(f"❌ ERROR en run_spotify_task: {e}")
        traceback.print_exc()
        shutil.rmtree(batch_folder, ignore_errors=True)
        with TASK_LOCK:
            TASKS[task_id].update({'status': 'failed', 'message': str(e), 'finished_at': datetime.utcnow().isoformat()})


@app.post("/download_spotify_playlist/")
async def download_spotify_playlist(
    request: Request,
    url: str         = Form(...),
    format_type: str = Form("mp3"),
    _session: dict   = Depends(require_auth),
):
    url = url.strip()
    if "spotify.com" not in url:
        raise HTTPException(status_code=400, detail="Por favor ingresa un link válido de Spotify")

    task_id      = str(uuid.uuid4())
    batch_folder = os.path.join(DOWNLOADS_DIR, task_id)
    os.makedirs(batch_folder, exist_ok=True)

    with TASK_LOCK:
        TASKS[task_id] = {
            'status': 'queued', 'progress': 0, 'total': 0, 'success': 0,
            'failed': [], 'zip_path': None, 'started_at': None,
            'finished_at': None, 'message': 'Conectando con Spotify...', 'current': None,
        }

    threading.Thread(target=run_spotify_task, args=(task_id, url, format_type, batch_folder), daemon=True).start()
    log_download(_session.get("code","?"), url, format_type, "spotify", True)
    return {"task_id": task_id, "message": "Tarea Spotify iniciada."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
