"""
auth_system.py
Sistema de autenticación con códigos divertidos para ROCKOLA
"""

import json
import os
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List

# Ruta del archivo JSON donde se guardan los códigos
BASE_DIR = Path(__file__).resolve().parent
CODES_FILE = BASE_DIR / "codes.json"

# Lista de palabras divertidas para generar códigos
ADJECTIVES = [
    "pizza", "helado", "planta", "teléfono", "hamburguesa", "taco", "tortilla", 
    "miel", "manzana", "toronja", "computadora", "serpiente", "fuego", "libro"
]

NOUNS = [
    "café", "leche", "coche", "bici", "hamburguesa", "pizza", "taco", "burrito",
    "perro", "gato", "pájaro", "pez", "árbol", "flor", "nube", "sol",
    "luna", "estrella", "montaña", "río", "playa", "bosque", "ciudad", "casa",
    "música", "guitarra", "piano", "batería", "micrófono", "altavoz"
]

CONNECTORS = ["con", "y", "de", "sin"]

class AuthSystem:
    def __init__(self):
        self.codes_file = CODES_FILE
        self._ensure_codes_file()
        self._ensure_admin_code()
    
    def _ensure_codes_file(self):
        """Crea el archivo codes.json si no existe"""
        if not self.codes_file.exists():
            with open(self.codes_file, 'w', encoding='utf-8') as f:
                json.dump({"codes": []}, f, indent=2, ensure_ascii=False)
    
    def _ensure_admin_code(self):
        """Asegura que tu código especial 'debloyan' exista y sea permanente"""
        codes = self._load_codes()
        
        # Buscar si ya existe el código debloyan
        debloyan_exists = any(code['code'] == 'debloyan' for code in codes)
        
        if not debloyan_exists:
            admin_code = {
                'code': 'debloyan',
                'created_at': datetime.now().isoformat(),
                'expires_at': None,  # None = permanente
                'is_admin': True,
                'used_count': 0
            }
            codes.append(admin_code)
            self._save_codes(codes)
            print("✅ Código administrador 'debloyan' creado")
    
    def _load_codes(self) -> List[Dict]:
        """Carga los códigos del archivo JSON"""
        try:
            with open(self.codes_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('codes', [])
        except Exception as e:
            print(f"Error cargando códigos: {e}")
            return []
    
    def _save_codes(self, codes: List[Dict]):
        """Guarda los códigos en el archivo JSON"""
        try:
            with open(self.codes_file, 'w', encoding='utf-8') as f:
                json.dump({'codes': codes}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error guardando códigos: {e}")
    
    def generate_fun_code(self) -> str:
        """Genera un código divertido aleatorio como 'café con leche' o 'coche rojo'"""
        # 50% de probabilidad de usar conector
        if random.choice([True, False]):
            # Formato: "sustantivo conector sustantivo" (ej: café con leche)
            noun1 = random.choice(NOUNS)
            connector = random.choice(CONNECTORS)
            noun2 = random.choice(NOUNS)
            code = f"{noun1} {connector} {noun2}"
        else:
            # Formato: "sustantivo adjetivo" (ej: coche rojo)
            noun = random.choice(NOUNS)
            adj = random.choice(ADJECTIVES)
            code = f"{noun} {adj}"
        
        # Asegurar que el código no exista ya
        codes = self._load_codes()
        existing_codes = [c['code'] for c in codes]
        
        # Si ya existe, generar otro (recursivo)
        if code in existing_codes:
            return self.generate_fun_code()
        
        return code
    
    def create_code(self, custom_code: Optional[str] = None, days: int = 30) -> Dict:
        """
        Crea un nuevo código
        Args:
            custom_code: Código personalizado (opcional, si no se da, genera uno divertido)
            days: Días hasta que expire (30 por defecto)
        Returns:
            Dict con la info del código creado
        """
        codes = self._load_codes()
        
        # Usar código personalizado o generar uno divertido
        code = custom_code if custom_code else self.generate_fun_code()
        
        # Verificar que no exista ya
        if any(c['code'] == code for c in codes):
            return {'error': 'Este código ya existe'}
        
        # Crear nuevo código
        new_code = {
            'code': code,
            'created_at': datetime.now().isoformat(),
            'expires_at': (datetime.now() + timedelta(days=days)).isoformat(),
            'is_admin': False,
            'used_count': 0
        }
        
        codes.append(new_code)
        self._save_codes(codes)
        
        return new_code
    
    def validate_code(self, code: str) -> Dict:
        """
        Valida si un código es válido
        Returns:
            Dict con 'valid': True/False y mensaje
        """
        codes = self._load_codes()
        
        # Buscar el código
        code_data = None
        for c in codes:
            if c['code'].lower() == code.lower():
                code_data = c
                break
        
        if not code_data:
            return {
                'valid': False,
                'message': 'Código inválido'
            }
        
        # Si es código admin (debloyan), siempre válido
        if code_data.get('is_admin'):
            # Incrementar contador de uso
            code_data['used_count'] = code_data.get('used_count', 0) + 1
            self._save_codes(codes)
            return {
                'valid': True,
                'message': 'Bienvenido, administrador',
                'is_admin': True
            }
        
        # Verificar expiración
        expires_at = code_data.get('expires_at')
        if expires_at:
            expiry_date = datetime.fromisoformat(expires_at)
            if datetime.now() > expiry_date:
                return {
                    'valid': False,
                    'message': 'Este código ha expirado'
                }
        
        # Código válido
        code_data['used_count'] = code_data.get('used_count', 0) + 1
        self._save_codes(codes)
        
        return {
            'valid': True,
            'message': '¡Acceso concedido!',
            'is_admin': False
        }
    
    def get_all_codes(self) -> List[Dict]:
        """Obtiene todos los códigos (para el panel admin)"""
        codes = self._load_codes()
        
        # Agregar info de si está expirado
        for code in codes:
            if code.get('expires_at'):
                expiry_date = datetime.fromisoformat(code['expires_at'])
                code['is_expired'] = datetime.now() > expiry_date
            else:
                code['is_expired'] = False
        
        return codes
    
    def delete_code(self, code: str) -> bool:
        """Elimina un código (excepto debloyan)"""
        if code.lower() == 'debloyan':
            return False  # No se puede eliminar el código admin
        
        codes = self._load_codes()
        codes = [c for c in codes if c['code'] != code]
        self._save_codes(codes)
        return True

# Instancia global
auth = AuthSystem()