"""
metadata_service.py - Sistema de metadatos automáticos para Rockola
Integra múltiples APIs para obtener información completa de canciones
"""

import requests
import urllib.parse
from typing import Dict, Optional, Any
import mutagen
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, APIC
from mutagen.mp3 import MP3
import io
import time

class MetadataService:
    """Servicio para obtener y aplicar metadatos a archivos MP3"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'RockolaApp/1.0 (Contact: tu@email.com)'
        })
    
    def search_metadata(self, title: str, artist: str = "") -> Optional[Dict[str, Any]]:
        """
        Busca metadatos usando múltiples fuentes
        Prioridad: iTunes API > MusicBrainz > Spotify Web API
        """
        # Intentar con iTunes primero (más rápido y confiable)
        metadata = self._search_itunes(title, artist)
        if metadata:
            return metadata
        
        # Intentar con MusicBrainz como fallback
        metadata = self._search_musicbrainz(title, artist)
        if metadata:
            return metadata
        
        return None
    
    def _search_itunes(self, title: str, artist: str = "") -> Optional[Dict[str, Any]]:
        """Busca en iTunes API (muy confiable y rápida)"""
        try:
            query = f"{title} {artist}".strip()
            encoded_query = urllib.parse.quote(query)
            
            url = f"https://itunes.apple.com/search?term={encoded_query}&media=music&entity=song&limit=1"
            
            response = self.session.get(url, timeout=10)
            if response.status_code != 200:
                return None
            
            data = response.json()
            
            if data.get('resultCount', 0) > 0:
                result = data['results'][0]
                
                metadata = {
                    'title': result.get('trackName', title),
                    'artist': result.get('artistName', artist),
                    'album': result.get('collectionName', ''),
                    'year': self._extract_year(result.get('releaseDate', '')),
                    'genre': result.get('primaryGenreName', ''),
                    'cover_url': result.get('artworkUrl100', '').replace('100x100', '600x600'),
                    'source': 'iTunes'
                }
                
                print(f"✅ Metadatos encontrados en iTunes: {metadata['title']} - {metadata['artist']}")
                return metadata
        
        except Exception as e:
            print(f"⚠️ Error en iTunes API: {e}")
        
        return None
    
    def _search_musicbrainz(self, title: str, artist: str = "") -> Optional[Dict[str, Any]]:
        """Busca en MusicBrainz API (más completa pero más lenta)"""
        try:
            # MusicBrainz requiere rate limiting (1 request/segundo)
            time.sleep(1.1)
            
            query_parts = []
            if title:
                query_parts.append(f'recording:"{title}"')
            if artist:
                query_parts.append(f'artist:"{artist}"')
            
            query = ' AND '.join(query_parts)
            encoded_query = urllib.parse.quote(query)
            
            url = f"https://musicbrainz.org/ws/2/recording/?query={encoded_query}&fmt=json&limit=1"
            
            response = self.session.get(url, timeout=15)
            if response.status_code != 200:
                return None
            
            data = response.json()
            
            if data.get('recordings') and len(data['recordings']) > 0:
                recording = data['recordings'][0]
                
                artist_name = artist
                if 'artist-credit' in recording and recording['artist-credit']:
                    artist_name = recording['artist-credit'][0].get('name', artist)
                
                album_name = ''
                year = ''
                if 'releases' in recording and recording['releases']:
                    album_name = recording['releases'][0].get('title', '')
                    release_date = recording['releases'][0].get('date', '')
                    year = self._extract_year(release_date)
                
                metadata = {
                    'title': recording.get('title', title),
                    'artist': artist_name,
                    'album': album_name,
                    'year': year,
                    'genre': self._extract_genre_from_tags(recording.get('tags', [])),
                    'cover_url': None,  # MusicBrainz no provee covers directamente
                    'source': 'MusicBrainz'
                }
                
                print(f"✅ Metadatos encontrados en MusicBrainz: {metadata['title']} - {metadata['artist']}")
                return metadata
        
        except Exception as e:
            print(f"⚠️ Error en MusicBrainz API: {e}")
        
        return None
    
    def _extract_year(self, date_str: str) -> str:
        """Extrae el año de diferentes formatos de fecha"""
        if not date_str:
            return ''
        
        # Formatos: "2023-05-15", "2023", "2023-05"
        return date_str.split('-')[0] if '-' in date_str else date_str[:4]
    
    def _extract_genre_from_tags(self, tags: list) -> str:
        """Extrae género desde tags de MusicBrainz"""
        if not tags:
            return ''
        
        # Obtener el tag con mayor count
        sorted_tags = sorted(tags, key=lambda x: x.get('count', 0), reverse=True)
        if sorted_tags:
            return sorted_tags[0].get('name', '').title()
        
        return ''
    
    def download_cover_art(self, cover_url: str) -> Optional[bytes]:
        """Descarga la imagen de la carátula"""
        if not cover_url:
            return None
        
        try:
            response = self.session.get(cover_url, timeout=10)
            if response.status_code == 200:
                return response.content
        except Exception as e:
            print(f"⚠️ Error descargando carátula: {e}")
        
        return None
    
    def apply_metadata_to_mp3(self, file_path: str, metadata: Dict[str, Any]) -> bool:
        """Aplica metadatos ID3v2 a un archivo MP3"""
        try:
            audio = MP3(file_path, ID3=ID3)
            
            # Crear tags si no existen
            if audio.tags is None:
                audio.add_tags()
            
            # Limpiar tags existentes (opcional)
            audio.tags.delete()
            
            # Aplicar metadatos básicos
            if metadata.get('title'):
                audio.tags.add(TIT2(encoding=3, text=metadata['title']))
            
            if metadata.get('artist'):
                audio.tags.add(TPE1(encoding=3, text=metadata['artist']))
            
            if metadata.get('album'):
                audio.tags.add(TALB(encoding=3, text=metadata['album']))
            
            if metadata.get('year'):
                audio.tags.add(TDRC(encoding=3, text=metadata['year']))
            
            if metadata.get('genre'):
                audio.tags.add(TCON(encoding=3, text=metadata['genre']))
            
            # Descargar y aplicar carátula
            if metadata.get('cover_url'):
                cover_data = self.download_cover_art(metadata['cover_url'])
                if cover_data:
                    audio.tags.add(
                        APIC(
                            encoding=3,
                            mime='image/jpeg',
                            type=3,  # 3 = Cover (front)
                            desc='Cover',
                            data=cover_data
                        )
                    )
                    print(f"🖼️ Carátula aplicada")
            
            # Guardar cambios
            audio.save()
            
            print(f"✅ Metadatos aplicados a: {file_path}")
            return True
        
        except Exception as e:
            print(f"❌ Error aplicando metadatos a {file_path}: {e}")
            return False
    
    def extract_info_from_filename(self, filename: str) -> Dict[str, str]:
        """
        Extrae título y artista del nombre del archivo
        Formatos soportados:
        - "Artista - Título.mp3"
        - "Título - Artista.mp3"
        - "Título.mp3"
        """
        # Remover extensión
        name = filename.rsplit('.', 1)[0]
        
        # Limpiar caracteres comunes
        name = name.replace('_', ' ').strip()
        
        if ' - ' in name:
            parts = name.split(' - ', 1)
            return {
                'artist': parts[0].strip(),
                'title': parts[1].strip()
            }
        else:
            return {
                'artist': '',
                'title': name.strip()
            }


# ============== INTEGRACIÓN CON MAIN.PY ==============

def enhance_download_with_metadata(file_path: str, video_title: str = "") -> bool:
    """
    Función helper para integrar en main.py
    Mejora un archivo MP3 descargado con metadatos automáticos
    """
    metadata_service = MetadataService()
    
    # Extraer información del título del video o nombre del archivo
    if video_title:
        info = metadata_service.extract_info_from_filename(video_title)
    else:
        import os
        filename = os.path.basename(file_path)
        info = metadata_service.extract_info_from_filename(filename)
    
    print(f"🔍 Buscando metadatos para: {info['title']} - {info['artist']}")
    
    # Buscar metadatos
    metadata = metadata_service.search_metadata(
        title=info['title'],
        artist=info['artist']
    )
    
    if not metadata:
        print(f"⚠️ No se encontraron metadatos para: {info['title']}")
        return False
    
    # Aplicar metadatos al archivo
    success = metadata_service.apply_metadata_to_mp3(file_path, metadata)
    
    return success


# ============== EJEMPLO DE USO ==============

if __name__ == "__main__":
    # Ejemplo de uso
    service = MetadataService()
    
    # Buscar metadatos
    metadata = service.search_metadata("Bohemian Rhapsody", "Queen")
    
    if metadata:
        print("\n📋 Metadatos encontrados:")
        for key, value in metadata.items():
            print(f"  {key}: {value}")
        
        # Aplicar a un archivo MP3
        # service.apply_metadata_to_mp3("ejemplo.mp3", metadata)
