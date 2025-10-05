from fastapi import FastAPI, Form, File, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from yt_dlp import YoutubeDL
import os
import uuid
import shutil
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def is_url(text):
    """Verifica si el texto es una URL válida"""
    url_pattern = re.compile(
        r'^https?://'  # http:// o https://
        r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'  # dominio
        r'localhost|'  # localhost
        r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'  # IP
        r'(?::\d+)?'  # puerto opcional
        r'(?:/?|[/?]\S+)$', re.IGNORECASE)
    return url_pattern.match(text) is not None


@app.post("/download/")
def download(url: str = Form(...), format_type: str = Form("mp3")):
    """Descarga individual desde URL"""
    output_folder = "downloads"
    os.makedirs(output_folder, exist_ok=True)
    filename = str(uuid.uuid4())

    ydl_opts = {
        'quiet': False,
        'no_warnings': False,
    }

    if format_type == "mp3":
        ydl_opts.update({
            'format': 'bestaudio/best',
            'outtmpl': f'{output_folder}/{filename}.%(ext)s',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        ydl_opts.update({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': f'{output_folder}/{filename}.%(ext)s',
            'merge_output_format': 'mp4',
        })

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        for file in os.listdir(output_folder):
            if file.startswith(filename):
                file_path = os.path.join(output_folder, file)
                
                def cleanup():
                    try:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                    except Exception:
                        pass
                
                return FileResponse(
                    path=file_path,
                    filename=file,
                    media_type="application/octet-stream",
                    background=cleanup
                )
        
        return {"error": "No se pudo encontrar el archivo descargado"}
        
    except Exception as e:
        error_msg = str(e)
        if "HTTP Error 403" in error_msg:
            error_msg = "Error 403: El video podría tener restricciones de región o edad"
        elif "Video unavailable" in error_msg:
            error_msg = "Video no disponible o URL inválida"
        elif "No video formats found" in error_msg:
            error_msg = "No se encontraron formatos disponibles para este video"
        
        return {"error": error_msg}


@app.post("/download_batch/")
async def download_batch(file: UploadFile = File(...), format_type: str = Form("mp3")):
    """Descarga múltiple desde archivo - soporta URLs o nombres de canciones"""
    output_folder = "downloads"
    os.makedirs(output_folder, exist_ok=True)
    
    # Leer contenido del archivo
    content = await file.read()
    lines = [line.strip() for line in content.decode('utf-8').strip().split('\n') if line.strip()]
    
    if not lines:
        return {"error": "El archivo está vacío"}
    
    # Crear carpeta para este batch
    batch_id = str(uuid.uuid4())
    batch_folder = os.path.join(output_folder, batch_id)
    os.makedirs(batch_folder, exist_ok=True)
    
    print(f"\n{'='*60}")
    print(f"Iniciando descarga de {len(lines)} elementos...")
    print(f"{'='*60}\n")
    
    successful_downloads = 0
    failed_downloads = []
    
    for i, line in enumerate(lines, 1):
        # Determinar si es URL o búsqueda
        if is_url(line):
            search_query = line
            print(f"[{i}/{len(lines)}] Descargando URL: {line[:50]}...")
        else:
            search_query = f"ytsearch1:{line}"
            print(f"[{i}/{len(lines)}] Buscando: {line}")
        
        ydl_opts = {
            'quiet': False,
            'no_warnings': False,
            'ignoreerrors': True,
        }
        
        if format_type == "mp3":
            ydl_opts.update({
                'format': 'bestaudio/best',
                'outtmpl': f'{batch_folder}/%(title)s.%(ext)s',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            })
        else:
            ydl_opts.update({
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'outtmpl': f'{batch_folder}/%(title)s.%(ext)s',
                'merge_output_format': 'mp4',
            })
        
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(search_query, download=True)
                
                if info:
                    # Obtener título del video descargado
                    if 'entries' in info and info['entries']:
                        title = info['entries'][0].get('title', 'Desconocido')
                    else:
                        title = info.get('title', 'Desconocido')
                    
                    print(f"  ✓ Descargado: {title}\n")
                    successful_downloads += 1
                else:
                    print(f"  ✗ No se encontró resultado\n")
                    failed_downloads.append(line)
        
        except Exception as e:
            error_msg = str(e)
            print(f"  ✗ Error: {error_msg[:100]}\n")
            failed_downloads.append(line)
    
    print(f"\n{'='*60}")
    print(f"Resumen:")
    print(f"  Exitosas: {successful_downloads}/{len(lines)}")
    print(f"  Fallidas: {len(failed_downloads)}/{len(lines)}")
    if failed_downloads:
        print(f"\nNo se pudieron descargar:")
        for item in failed_downloads[:5]:  # Mostrar solo las primeras 5
            print(f"  - {item}")
        if len(failed_downloads) > 5:
            print(f"  ... y {len(failed_downloads) - 5} más")
    print(f"{'='*60}\n")
    
    # Verificar si se descargó algo
    downloaded_files = os.listdir(batch_folder)
    if not downloaded_files:
        shutil.rmtree(batch_folder)
        return {"error": "No se pudo descargar ningún archivo. Revisa la consola del servidor para más detalles."}
    
    zip_path = None
    try:
        # Crear ZIP
        zip_path = f"{output_folder}/{batch_id}"
        shutil.make_archive(zip_path, 'zip', batch_folder)
        
        # Limpiar carpeta temporal
        shutil.rmtree(batch_folder)
        
        def cleanup():
            try:
                if os.path.exists(f"{zip_path}.zip"):
                    os.remove(f"{zip_path}.zip")
            except Exception:
                pass
        
        return FileResponse(
            path=f"{zip_path}.zip",
            filename="batch_download.zip",
            media_type="application/zip",
            background=cleanup
        )
    except Exception as e:
        if os.path.exists(batch_folder):
            shutil.rmtree(batch_folder)
        if zip_path and os.path.exists(f"{zip_path}.zip"):
            os.remove(f"{zip_path}.zip")
        
        return {"error": f"Error al crear ZIP: {str(e)}"}


@app.post("/download_playlist/")
def download_playlist(url: str = Form(...), format_type: str = Form("mp3")):
    """Descarga playlist completa"""
    output_folder = "downloads"
    os.makedirs(output_folder, exist_ok=True)
    
    playlist_id = str(uuid.uuid4())
    playlist_folder = os.path.join(output_folder, playlist_id)
    os.makedirs(playlist_folder, exist_ok=True)
    
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
    }
    
    if format_type == "mp3":
        ydl_opts.update({
            'format': 'bestaudio/best',
            'outtmpl': f'{playlist_folder}/%(playlist_index)s - %(title)s.%(ext)s',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        ydl_opts.update({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': f'{playlist_folder}/%(playlist_index)s - %(title)s.%(ext)s',
            'merge_output_format': 'mp4',
        })
    
    zip_path = None
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        if not os.listdir(playlist_folder):
            shutil.rmtree(playlist_folder)
            return {"error": "No se pudo descargar ningún video de la playlist"}
        
        zip_path = f"{output_folder}/{playlist_id}"
        shutil.make_archive(zip_path, 'zip', playlist_folder)
        shutil.rmtree(playlist_folder)
        
        def cleanup():
            try:
                if os.path.exists(f"{zip_path}.zip"):
                    os.remove(f"{zip_path}.zip")
            except Exception:
                pass
        
        return FileResponse(
            path=f"{zip_path}.zip",
            filename="playlist_download.zip",
            media_type="application/zip",
            background=cleanup
        )
    except Exception as e:
        if os.path.exists(playlist_folder):
            shutil.rmtree(playlist_folder)
        if zip_path and os.path.exists(f"{zip_path}.zip"):
            os.remove(f"{zip_path}.zip")
        
        error_msg = str(e)
        if "playlist" in error_msg.lower() and "not" in error_msg.lower():
            error_msg = "La URL no parece ser una playlist válida"
        
        return {"error": error_msg}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)