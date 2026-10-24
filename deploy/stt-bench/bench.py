#!/usr/bin/env python3
"""Speech-to-text benchmark for a server candidate.

Transcribes audio/video files with faster-whisper on the CPU, the way a server-side speech service
would (int8 weights, beam search, voice activity detection, word timings), and reports per model:
load time, processing time, real-time factor, peak memory, the text with timings and, with --ref,
the word/character error rates against a correct transcript.

    python bench.py /data/test.mp4 --ref /data/ref.txt
"""
import argparse
import os
import platform
import resource
import sys
import time

from faster_whisper import WhisperModel

# Persian normalisation for scoring, built from code points so no invisible characters live here.
ARABIC_YEH, PERSIAN_YEH = chr(0x064A), chr(0x06CC)
ARABIC_KAF, PERSIAN_KAF = chr(0x0643), chr(0x06A9)
ALEFS = {chr(0x0623), chr(0x0625), chr(0x0622)}
DROP = {chr(c) for c in range(0x064B, 0x0653)} | {chr(0x0670)}
SPACE = {chr(0x200C)} | set('.,!?:;"\'()-|') | {chr(0x061F), chr(0x060C), chr(0x061B), chr(0x00AB), chr(0x00BB), chr(0x2013), chr(0x2014)}


def normalize(text: str) -> str:
    out = []
    for ch in text:
        if ch in DROP:
            continue
        if ch == ARABIC_YEH:
            ch = PERSIAN_YEH
        elif ch == ARABIC_KAF:
            ch = PERSIAN_KAF
        elif ch in ALEFS:
            ch = chr(0x0627)
        elif ch in SPACE:
            ch = ' '
        out.append(ch)
    return ' '.join(''.join(out).split())


def distance(a, b) -> int:
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[-1]


def score(ref: str, hyp: str) -> tuple[float, float]:
    r, h = normalize(ref), normalize(hyp)
    rw, rc = r.split(' '), list(r.replace(' ', ''))
    return distance(rw, h.split(' ')) / len(rw), distance(rc, list(h.replace(' ', ''))) / len(rc)


def cpu_info() -> str:
    model, flags = '?', set()
    try:
        with open('/proc/cpuinfo') as f:
            for line in f:
                if line.startswith('model name') and model == '?':
                    model = line.split(':', 1)[1].strip()
                elif line.startswith('flags'):
                    flags = set(line.split(':', 1)[1].split())
    except OSError:
        pass
    simd = ' '.join(x for x in ('avx2', 'avx512f', 'avx512_vnni', 'amx_int8') if x in flags) or 'none'
    return f'{model} | {os.cpu_count()} threads | {simd} | {platform.machine()}'


def mem_gb() -> str:
    try:
        with open('/proc/meminfo') as f:
            total = next(int(l.split()[1]) for l in f if l.startswith('MemTotal'))
        return f'{total / 2**20:.1f} GB'
    except (OSError, StopIteration):
        return '?'


def fmt(t: float) -> str:
    return f'{int(t // 60):02d}:{t % 60:05.2f}'


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('media', nargs='+', help='audio or video files (mp4, mp3, wav, ...)')
    p.add_argument('--models', default='large-v3-turbo,large-v3', help='comma-separated; also tiny, base, small, medium or a Hugging Face repo id')
    p.add_argument('--compute', default='int8', help='int8 (default), int8_float32 or float32')
    p.add_argument('--beam', type=int, default=5)
    p.add_argument('--language', default='fa')
    p.add_argument('--threads', type=int, default=os.cpu_count() or 4)
    p.add_argument('--prompt', default=None, help='words to expect (names, products): helps spelling')
    p.add_argument('--ref', default=None, help='correct transcript of the (first) file, for WER/CER')
    p.add_argument('--out', default='/data/stt-bench-report.txt')
    a = p.parse_args()

    ref = open(a.ref, encoding='utf-8').read() if a.ref else None
    report = open(a.out, 'w', encoding='utf-8')

    def log(line: str = '') -> None:
        print(line, flush=True)
        report.write(line + '\n')
        report.flush()

    log(f'CPU: {cpu_info()}')
    log(f'RAM: {mem_gb()} | threads used: {a.threads} | compute: {a.compute} | beam: {a.beam} | language: {a.language}')
    log()
    for name in [m.strip() for m in a.models.split(',') if m.strip()]:
        t0 = time.perf_counter()
        model = WhisperModel(name, device='cpu', compute_type=a.compute, cpu_threads=a.threads)
        load = time.perf_counter() - t0
        for i, path in enumerate(a.media):
            t1 = time.perf_counter()
            segments, info = model.transcribe(
                path,
                language=a.language,
                beam_size=a.beam,
                vad_filter=True,
                word_timestamps=True,
                condition_on_previous_text=False,
                initial_prompt=a.prompt,
            )
            segments = list(segments)  # transcription happens while iterating
            run = time.perf_counter() - t1
            text = ' '.join(s.text.strip() for s in segments)
            words = sum(len(s.words or []) for s in segments)
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20
            line = f'== {name} | {os.path.basename(path)} {info.duration:.1f} s | load {load:.1f} s | run {run:.1f} s | RTF {run / max(info.duration, 1e-9):.2f} | peak RAM {peak:.1f} GB | {words} timed words'
            if ref is not None and i == 0:
                wer, cer = score(ref, text)
                line += f' | WER {wer:.1%} | CER {cer:.1%}'
            log(line)
            for s in segments:
                log(f'[{fmt(s.start)} - {fmt(s.end)}] {s.text.strip()}')
            log()
        del model
    log(f'Report saved to {a.out}')


if __name__ == '__main__':
    sys.exit(main())
