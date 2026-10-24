# Speech-to-text benchmark for a server candidate (see README.md).
#   docker build -t stt-bench .
# Where Docker Hub or PyPI is blocked, point at mirrors:
#   docker build -t stt-bench --build-arg BASE=<mirror>/library/python:3.12-slim --build-arg PIP_INDEX_URL=<mirror>/simple .
# PRELOAD bakes models into the image (for servers that cannot reach huggingface.co), e.g.
#   --build-arg PRELOAD=large-v3-turbo,large-v3
ARG BASE=python:3.12-slim
FROM ${BASE}
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" faster-whisper==1.1.1
# Downloaded models land here; without PRELOAD, mount a folder on it so they are fetched only once.
ENV HF_HOME=/models
ARG PRELOAD=""
RUN if [ -n "$PRELOAD" ]; then python -c "import sys; from faster_whisper.utils import download_model; [download_model(m) for m in sys.argv[1].split(',')]" "$PRELOAD"; fi
WORKDIR /app
COPY bench.py .
ENTRYPOINT ["python", "/app/bench.py"]
