"""
Configuration file for Marine Threat Surveillance System
Centralizes all hardcoded paths and settings for production deployment
"""

import os
from pathlib import Path

# Project paths
BASE_DIR = Path(__file__).resolve().parent
WEBSITE_DIR = BASE_DIR / "website"
STATIC_DIR = WEBSITE_DIR / "static"
TEMPLATE_DIR = WEBSITE_DIR / "template"
MODEL_DIR = BASE_DIR / "model"

# Create directories if they don't exist
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Model configuration
MODEL_PATH = MODEL_DIR / "best_model.pth"
FALLBACK_MODEL_PATH = BASE_DIR / "final" / "best_model.pth"

# Normalization parameters (extracted from training dataset)
NORMALIZATION = {
    'mean': [0.2842, 0.3798, 0.4523],
    'std': [0.2231, 0.1942, 0.1880]
}

# Image processing
IMAGE_SIZE = 224
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'bmp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB in bytes
CONFIDENCE_THRESHOLD = 0.5

# Classification classes
CLASSES = ['not threat', 'threat']

# Flask configuration
DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
SECRET_KEY = os.getenv('SECRET_KEY', 'dev-key-change-in-production')
UPLOAD_FOLDER = str(STATIC_DIR)

# Logging
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

# Security
CORS_ORIGINS = os.getenv(
    'CORS_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5000,http://127.0.0.1:5000'
).split(',')
RATE_LIMIT_ENABLED = os.getenv('RATE_LIMIT', 'True').lower() == 'true'
RATE_LIMIT = "100 per hour"
