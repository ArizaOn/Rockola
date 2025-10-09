#!/usr/bin/env python3
"""
Script para generar cookies.txt automáticamente desde Chrome
Ejecutar esto antes de iniciar el servidor FastAPI
"""

import subprocess
import os
import sys

COOKIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")

def generate_cookies():
    """Genera el archivo cookies.txt usando yt-dlp y Chrome"""
    
    print("🔄 Generando cookies desde Chrome...")
    print(f"📁 Ruta: {COOKIES_PATH}")
    
    try:
        # Comando para generar cookies
        cmd = [
            "yt-dlp",
            "--cookies-from-browser", "chrome",
            "--write-cookies",
            "--cookies", COOKIES_PATH,
            "https://www.youtube.com"
        ]
        
        # Ejecutar el comando
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            if os.path.exists(COOKIES_PATH):
                file_size = os.path.getsize(COOKIES_PATH)
                print(f"✅ Cookies generadas exitosamente!")
                print(f"📊 Tamaño del archivo: {file_size} bytes")
                return True
            else:
                print("⚠️ El archivo de cookies no se creó")
                return False
        else:
            print(f"❌ Error al generar cookies:")
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        print("❌ Timeout: El proceso tardó demasiado")
        return False
    except FileNotFoundError:
        print("❌ Error: yt-dlp no está instalado")
        print("Instálalo con: pip install yt-dlp")
        return False
    except Exception as e:
        print(f"❌ Error inesperado: {str(e)}")
        return False

def check_cookies():
    """Verifica si el archivo de cookies existe y es válido"""
    if os.path.exists(COOKIES_PATH):
        file_size = os.path.getsize(COOKIES_PATH)
        if file_size > 100:  # Al menos 100 bytes
            print(f"✅ Archivo de cookies existente encontrado ({file_size} bytes)")
            return True
        else:
            print(f"⚠️ Archivo de cookies muy pequeño ({file_size} bytes), regenerando...")
            return False
    return False

if __name__ == "__main__":
    print("=" * 50)
    print("🎬 Generador de Cookies para yt-dlp")
    print("=" * 50)
    
    # Primero verificar si ya existe
    if check_cookies():
        print("💾 Usando cookies existentes")
        sys.exit(0)
    
    # Si no existe, generar
    print("\n📝 Creando nuevas cookies...")
    if generate_cookies():
        print("\n✅ Listo para iniciar el servidor!")
        sys.exit(0)
    else:
        print("\n⚠️ No se pudo generar las cookies automáticamente")
        print("El servidor intentará funcionar sin cookies")
        sys.exit(1)