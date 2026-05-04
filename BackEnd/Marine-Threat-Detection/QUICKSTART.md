# Quick Start Guide - Marine Threat Surveillance System

## 5-Minute Setup

### Step 1: Install Dependencies
```bash
cd Marine-Threat-Detection/BackEnd/Marine-Threat-Detection
pip install -r requirements.txt
```

### Step 2: Download Model
Download the pre-trained model from:
https://drive.google.com/file/d/1yI95wNAKAFZmeNaYv9ljmqQUoz7q46TP/view

Extract to:
```
model/best_model.pth
```

### Step 3: Run Application
```bash
cd website
python app_improved.py
```

### Step 4: Open Browser
Navigate to: **http://localhost:5000/**

---

## Usage Examples

### Example 1: Web Interface
1. Click "📸 Upload Marine Species Image"
2. Select a JPG/PNG image
3. Click "🔍 Analyze Image"
4. View prediction with confidence score

### Example 2: API Call
```bash
curl -X POST http://localhost:5000/api/predict \
  -F "my_image=@marine_image.jpg"
```

**Response:**
```json
{
    "success": true,
    "prediction": "threat",
    "confidence": "87.25%",
    "all_scores": {
        "not threat": "12.75%",
        "threat": "87.25%"
    }
}
```

### Example 3: Python Integration
```python
import requests

# Upload and get prediction
with open('image.jpg', 'rb') as f:
    files = {'my_image': f}
    response = requests.post('http://localhost:5000/api/predict', files=files)
    result = response.json()
    
print(f"Prediction: {result['prediction']}")
print(f"Confidence: {result['confidence']}")
print(f"All Scores: {result['all_scores']}")
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app_improved.py` | Main Flask application (production-ready) |
| `config.py` | Configuration settings |
| `utils.py` | Helper functions |
| `Training_Methodology.ipynb` | Complete training documentation |
| `requirements.txt` | Python dependencies |
| `index_improved.html` | Modern UI with confidence visualization |

---

## Common Tasks

### Change Model Path
Edit `config.py`:
```python
CONFIG['model_dir'] = Path('/your/model/path')
```

### Adjust Confidence Threshold
Edit `config.py`:
```python
CONFIG['confidence_threshold'] = 0.75  # 75% minimum confidence
```

### Increase File Upload Limit
Edit `config.py`:
```python
CONFIG['max_file_size'] = 50 * 1024 * 1024  # 50MB
```

### Enable GPU
Edit `config.py`:
```python
CONFIG['device'] = 'cuda'  # Requires CUDA-capable GPU
```

### Check Model Status
```bash
curl http://localhost:5000/health
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Model not found" | Download and place in `model/best_model.pth` |
| Port 5000 in use | Change in `app_improved.py`: `app.run(port=5001)` |
| "No module named torch" | Run: `pip install -r requirements.txt` |
| Out of memory | Reduce `batch_size` in `config.py` |
| Slow predictions | Enable GPU: set `device='cuda'` |

---

## What's New vs Original

✅ **Confidence Scores** - See prediction confidence  
✅ **Error Handling** - Better error messages  
✅ **Security** - File validation, rate limiting  
✅ **Configuration** - All settings in one place  
✅ **Logging** - Full audit trail  
✅ **Documentation** - Complete training methodology  
✅ **API** - JSON endpoint for integration  
✅ **UI** - Modern responsive design  

---

## Next Steps

1. **Read Full Documentation:** [PRODUCTION_READY.md](PRODUCTION_READY.md)
2. **Train Your Model:** [model/Training_Methodology.ipynb](model/Training_Methodology.ipynb)
3. **Explore API:** Check `/health` endpoint
4. **Deploy:** See deployment section in PRODUCTION_READY.md

---

## Performance Tips

- **Faster:** Use GPU (`DEVICE=cuda`)
- **Batch Processing:** Post multiple images to `/api/predict`
- **Caching:** Browser caches predictions
- **Optimization:** Larger batch sizes for better throughput

---

## Support

For issues, check:
1. Logs in `logs/app.log`
2. Configuration in `config.py`
3. Full documentation in `PRODUCTION_READY.md`
4. Training guide in `model/Training_Methodology.ipynb`

---

**Happy threat detecting! 🎯**
