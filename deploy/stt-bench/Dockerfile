# Speech-to-text benchmark for a server candidate (see README.md).
#   docker build -t stt-bench .
# Where Docker Hub or PyPI is blocked, point at mirrors:
#   docker build -t stt-bench --build-arg BASE=<mirror>/library/python:3.12-slim --build-arg PIP_INDEX_URL=<mirror>/simple .
ARG BASE=python:3.12-slim
FROM ${BASE}
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" faster-whisper==1.1.1
# Downloaded models land here; mount a folder on it so they are fetched only once.
ENV HF_HOME=/models
WORKDIR /app
COPY bench.py .
ENTRYPOINT ["python", "/app/bench.py"]
