# Speech-to-text server benchmark

Measures how fast and how accurately a server candidate transcribes Persian with faster-whisper
(Whisper large-v3-turbo and large-v3, int8, beam search 5, voice activity detection, word timings),
before committing to a server-side speech service. CPU only; any x86_64 Ubuntu with Docker.

## On the server (Ubuntu 24.04)

```bash
sudo apt update && sudo apt install -y docker.io
mkdir -p ~/stt-bench/data ~/stt-bench/models
```

Copy this folder and a test video from your PC (PowerShell on Windows has `scp`):

```powershell
scp deploy\stt-bench\Dockerfile deploy\stt-bench\bench.py root@SERVER_IP:~/stt-bench/
scp "C:\path\to\video.mp4" root@SERVER_IP:~/stt-bench/data/test.mp4
```

Optional: the correct transcript of the video as `~/stt-bench/data/ref.txt` (UTF-8) adds word and
character error rates to the report.

## Run

```bash
cd ~/stt-bench
sudo docker build -t stt-bench .
sudo docker run --rm -v "$PWD/data:/data" -v "$PWD/models:/models" stt-bench /data/test.mp4 --ref /data/ref.txt
```

Leave out `--ref ...` without a transcript. The first run downloads the models (~4.5 GB) from
huggingface.co into `models/`. The report is printed and saved as `data/stt-bench-report.txt`:
CPU model and SIMD flags, then per model the load time, processing time, real-time factor (RTF:
processing seconds per audio second), peak RAM and the text with timings.

Other options: `--models tiny,small,large-v3-turbo`, `--prompt "names and product words"`,
`--beam 1` (faster, a little less accurate), `--compute int8_float32`.

## If a download is blocked

- `Temporary failure in name resolution` during `pip install`: containers do not see the host's
  DNS (systemd-resolved). Build and run with the host's network: `docker build --network host ...`
  and `docker run --network host ...`.

- `docker build` fails pulling `python:3.12-slim` (403 from Docker Hub): use the cloud provider's
  Docker Hub mirror, e.g. `--build-arg BASE=docker.arvancloud.ir/library/python:3.12-slim`, or set
  it in `/etc/docker/daemon.json` as `{"registry-mirrors": ["https://docker.arvancloud.ir"]}` and
  `sudo systemctl restart docker`.
- `pip install` fails: `--build-arg PIP_INDEX_URL=<a PyPI mirror>/simple`.
- Models do not download: add `-e HF_ENDPOINT=<a Hugging Face mirror>` to `docker run`.
