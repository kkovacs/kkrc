

## Transcribe speech from audio files (local, uv/python, no API, no upload)

No env var needed. First run downloads the Whisper model to `~/.cache/huggingface/` (~75 MB for `base`, ~460 MB for `small`, ~1.5 GB for `large-v3`); subsequent runs are instant and fully offline.

### Audio → text (faster-whisper)

```bash
uvx --from faster-whisper python -c "
from faster_whisper import WhisperModel
model = WhisperModel('base')   # tiny|base|small|medium|large-v3 — bigger = slower but more accurate
segments, info = model.transcribe('file.wav')
print(f'language={info.language} prob={info.language_probability:.2f}')
for s in segments:
    print(f'[{s.start:6.1f}s → {s.end:6.1f}s] {s.text}')
"
```

100% local after the model download — no audio leaves your machine. Auto-detects language, emits timestamped segments. Needs `ffmpeg` on PATH for non-WAV formats (MP3, M4A, MP4, FLAC, OGG, …).


