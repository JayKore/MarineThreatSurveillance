"""
Utility functions for Marine Threat Surveillance System
"""

import torch
import torch.nn.functional as F
from PIL import Image
import logging
from pathlib import Path
from typing import Dict, Tuple, List

logger = logging.getLogger(__name__)

class PredictionResult:
    """Structured prediction result with confidence scores"""
    
    def __init__(self, prediction: str, confidence: float, all_scores: Dict[str, float], 
                 image_path: str, class_id: int, timestamp: str = None):
        self.prediction = prediction
        self.confidence = confidence
        self.all_scores = all_scores
        self.image_path = image_path
        self.class_id = class_id
        self.timestamp = timestamp
        self.is_confident = confidence >= 0.5
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            'prediction': self.prediction,
            'confidence': self.confidence,
            'confidence_percent': f"{self.confidence:.1%}",
            'all_scores': {k: f"{v:.1%}" for k, v in self.all_scores.items()},
            'image_path': self.image_path,
            'class_id': self.class_id,
            'is_confident': self.is_confident,
            'timestamp': self.timestamp
        }
    
    def __repr__(self):
        return (f"Prediction(label={self.prediction}, "
                f"confidence={self.confidence:.2%}, "
                f"confident={self.is_confident})")

def preprocess_image(image_path: str, image_size: int = 224, 
                    mean: List[float] = None, std: List[float] = None) -> torch.Tensor:
    """
    Preprocess image for model inference
    
    Args:
        image_path: Path to image file
        image_size: Target image size
        mean: Normalization mean
        std: Normalization std
    
    Returns:
        Preprocessed image tensor
    """
    import torchvision.transforms as transforms
    
    if mean is None:
        mean = [0.2842, 0.3798, 0.4523]
    if std is None:
        std = [0.2231, 0.1942, 0.1880]
    
    try:
        image = Image.open(image_path).convert('RGB')
        transform = transforms.Compose([
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(
                torch.Tensor(mean),
                torch.Tensor(std)
            )
        ])
        return transform(image)
    except Exception as e:
        logger.error(f"Error preprocessing {image_path}: {e}")
        raise

def get_model_prediction(model: torch.nn.Module, image_path: str, classes: List[str],
                        device: torch.device = None, image_size: int = 224,
                        mean: List[float] = None, std: List[float] = None) -> PredictionResult:
    """
    Get prediction from model with full confidence scores
    
    Args:
        model: PyTorch model
        image_path: Path to image
        classes: List of class names
        device: Torch device
        image_size: Image size for preprocessing
        mean: Normalization mean
        std: Normalization std
    
    Returns:
        PredictionResult object
    """
    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    
    try:
        model.eval()
        
        # Preprocess
        image_tensor = preprocess_image(image_path, image_size, mean, std)
        image_tensor = image_tensor.unsqueeze(0).to(device)
        
        # Predict
        with torch.no_grad():
            output = model(image_tensor)
            probabilities = F.softmax(output, dim=1)[0]
        
        confidence, predicted_class = torch.max(probabilities, 0)
        predicted_label = classes[predicted_class.item()]
        confidence_score = confidence.item()
        
        # All scores
        all_scores = {
            classes[i]: probabilities[i].item()
            for i in range(len(classes))
        }
        
        result = PredictionResult(
            prediction=predicted_label,
            confidence=confidence_score,
            all_scores=all_scores,
            image_path=str(image_path),
            class_id=predicted_class.item()
        )
        
        logger.info(f"Prediction: {result}")
        return result
        
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise

def sanitize_filename(filename: str, max_length: int = 255) -> str:
    """Sanitize filename to prevent path traversal attacks"""
    import re
    import uuid
    
    # Remove path separators and special chars
    filename = re.sub(r'[^a-zA-Z0-9._-]', '', filename)
    
    # Limit length
    if len(filename) > max_length:
        name, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
        name = name[:max_length - len(ext) - 1]
        filename = f"{name}.{ext}"
    
    # Add UUID for uniqueness
    base, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
    return f"image_{uuid.uuid4().hex[:8]}.{ext}"

def validate_image_file(filepath: str, max_size_mb: int = 10,
                       allowed_formats: List[str] = None) -> Tuple[bool, str]:
    """
    Validate image file
    
    Returns:
        (is_valid, error_message)
    """
    if allowed_formats is None:
        allowed_formats = ['jpg', 'jpeg', 'png', 'gif', 'bmp']
    
    try:
        path = Path(filepath)
        
        # Check existence
        if not path.exists():
            return False, "File not found"
        
        # Check file size
        file_size_mb = path.stat().st_size / (1024 * 1024)
        if file_size_mb > max_size_mb:
            return False, f"File too large ({file_size_mb:.1f}MB > {max_size_mb}MB)"
        
        # Check extension
        ext = path.suffix.lstrip('.').lower()
        if ext not in allowed_formats:
            return False, f"Invalid format: .{ext} (allowed: {', '.join(allowed_formats)})"
        
        # Check if valid image
        try:
            img = Image.open(filepath)
            img.verify()
        except Exception as e:
            return False, f"Invalid image: {str(e)}"
        
        return True, None
        
    except Exception as e:
        return False, f"Validation error: {str(e)}"

def get_confidence_indicator(confidence: float) -> Dict[str, str]:
    """Get UI indicator for confidence level"""
    if confidence >= 0.9:
        return {'level': 'very_high', 'icon': '🟢', 'text': 'Very Confident'}
    elif confidence >= 0.75:
        return {'level': 'high', 'icon': '🟡', 'text': 'Confident'}
    elif confidence >= 0.5:
        return {'level': 'medium', 'icon': '🟠', 'text': 'Moderate'}
    else:
        return {'level': 'low', 'icon': '🔴', 'text': 'Low Confidence'}
