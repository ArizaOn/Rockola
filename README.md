# Rockola
Web para descargar canciones una por una (zzz) o usando un archivo .txt o un archivo excel .xlsx de forma automática

Debo de aclarar que el uso de esta web para descargar canciones queda totalmente en la responsabilidad de las personas que lo usen la web. Yo como única persona que programó esta web te puedo prometer que no metí algún virus o troyano, es más, no tengo ni idea de virus y ciberseguridad, por eso mismo lo dejo a tu responsabilidad, pues quizá terceros puedan meter virus.

Actualización, ya sé, un poquito de ciberceguridad... nah aún practicamente nada jaja

----------

## Instalación

> ⚠️ Requiere Python 3.13. Python 3.14 (actual en Arch) no es compatible con `pydantic-core`.

```bash
yay -S python313
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install mutagen
python main.py
```

Abre el navegador en http://localhost:5000

----------

## Notas de desarrollo

- Línea 782 de `main.py`: `from spotify_scraper import SpotifyClient` — comentada, pendiente de reemplazar con scraping directo vía `requests` + `beautifulsoup4`.
