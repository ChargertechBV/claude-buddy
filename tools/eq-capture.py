"""Windows-side helper for the Soundtrack mod: WASAPI loopback -> band levels on stdout.

Runs under Windows Python (python.exe) with pyaudiowpatch and numpy. Captures
whatever the default output device is playing, splits each chunk into BANDS
log-spaced frequency bands and prints one line per chunk: an eight-digit hex
timestamp (ms on the helper's own clock), then BANDS two-digit hex values
(00 silent .. ff loud), about 60 lines a second. Nothing is written to disk.

Usage: python.exe eq-capture.py [bands]
"""
import sys
import time

import numpy as np
import pyaudiowpatch as pa

BANDS = int(sys.argv[1]) if len(sys.argv) > 1 else 24
FPS = 60          # analyses per second
WINDOW_FPS = 30   # each analysis looks at 1/30 s of audio, so windows overlap by half
LOW_HZ = 40.0
HIGH_HZ = 16000.0
HEX = "0123456789abcdef"


def open_loopback(audio):
    """The loopback twin of the default output device, as pyaudiowpatch exposes it."""
    wasapi = audio.get_host_api_info_by_type(pa.paWASAPI)
    default = audio.get_device_info_by_index(wasapi["defaultOutputDevice"])
    if not default.get("isLoopbackDevice"):
        for dev in audio.get_loopback_device_info_generator():
            if default["name"] in dev["name"]:
                default = dev
                break
    rate = int(default["defaultSampleRate"])
    channels = int(default["maxInputChannels"])
    frames = max(256, rate // WINDOW_FPS)
    stream = audio.open(
        format=pa.paFloat32,
        channels=channels,
        rate=rate,
        input=True,
        input_device_index=default["index"],
        frames_per_buffer=frames,
    )
    return stream, rate, channels, frames, default["name"]


def band_edges(rate, size):
    freqs = np.fft.rfftfreq(size, 1.0 / rate)
    edges = np.geomspace(LOW_HZ, min(HIGH_HZ, rate / 2), BANDS + 1)
    idx = np.searchsorted(freqs, edges)
    # Every band gets at least one bin.
    for i in range(1, len(idx)):
        if idx[i] <= idx[i - 1]:
            idx[i] = idx[i - 1] + 1
    return np.clip(idx, 0, len(freqs) - 1)


def main():
    audio = pa.PyAudio()
    out = sys.stdout
    t0 = time.perf_counter()

    def stamp():
        return "%08x" % (int((time.perf_counter() - t0) * 1000) & 0xFFFFFFFF)

    while True:
        try:
            stream, rate, channels, frames, name = open_loopback(audio)
        except Exception as err:  # no device yet: say so, wait, retry
            print("# no loopback device: " + str(err).replace("\n", " "), file=sys.stderr, flush=True)
            time.sleep(2)
            continue
        print("# capturing " + name + " @" + str(rate), file=sys.stderr, flush=True)
        window = np.hanning(frames).astype(np.float32)
        hop = max(64, rate // FPS)
        recent = np.zeros(frames, dtype=np.float32)  # the last `frames` samples, analysed every `hop`
        last_audio_at = time.perf_counter()
        last_line_at = last_audio_at
        nfft = max(4096, frames)  # zero-padded FFT: finer bins, so many narrow low bands each get their own
        edges = band_edges(rate, nfft)
        # Levels in dB relative to a full-scale sine; highs get a lift so they
        # are not buried under the bass; a slowly falling ceiling tracks the
        # loudness of what is playing so the loudest band sits near the top.
        # A band's level is its energy (root of the summed squared bins), so a
        # wide high band counts all of its bins; a mild tilt keeps the bass honest.
        ref = frames / 4.0
        tilt_db = np.linspace(-6.0, 1.0, BANDS, dtype=np.float32)
        ceiling = -30.0
        span_db = 55.0
        smooth = np.zeros(BANDS, dtype=np.float32)
        try:
            while True:
                # A WASAPI loopback stream delivers nothing while the output is
                # silent, so never block on it. Between chunks of a playing
                # stream just wait; only once audio has been absent for a while
                # let the meter fall and keep the lines coming.
                if stream.get_read_available() < hop:
                    time.sleep(0.004)
                    now = time.perf_counter()
                    if now - last_audio_at > 0.12 and now - last_line_at >= 1.0 / FPS:
                        smooth = smooth * 0.8
                        out.write(stamp() + "".join("%02x" % int(v * 255.999) for v in smooth) + "\n")
                        out.flush()
                        last_line_at = now
                    continue
                last_audio_at = time.perf_counter()
                last_line_at = last_audio_at
                raw = stream.read(hop, exception_on_overflow=False)
                data = np.frombuffer(raw, dtype=np.float32)
                if channels > 1:
                    data = data.reshape(-1, channels).mean(axis=1)
                if data.size >= frames:
                    recent = data[-frames:].astype(np.float32)
                else:
                    recent = np.concatenate((recent[data.size:], data.astype(np.float32)))
                spectrum = np.abs(np.fft.rfft(recent * window, n=nfft)) / ref
                power = spectrum * spectrum
                db = np.full(BANDS, -120.0, dtype=np.float32)
                for b in range(BANDS):
                    seg = power[edges[b]:edges[b + 1]]
                    if seg.size:
                        db[b] = 10.0 * np.log10(float(seg.sum()) + 1e-14)
                db += tilt_db
                top = float(db.max())
                if top > -70.0:
                    ceiling = max(top, ceiling - 0.15)  # jumps up, drifts down ~4.5 dB/s
                else:
                    ceiling = max(-70.0, ceiling - 0.5)  # silence: let the ceiling fall faster
                levels = np.clip((db - (ceiling - span_db)) / span_db, 0.0, 1.0)
                if top <= -70.0:
                    levels[:] = 0.0
                # Fast attack, slower release, like a real meter.
                smooth = np.where(levels > smooth, levels, smooth * 0.82 + levels * 0.18)
                out.write(stamp() + "".join("%02x" % int(v * 255.999) for v in smooth) + "\n")
                out.flush()
        except Exception as err:
            print("# stream ended: " + str(err).replace("\n", " "), file=sys.stderr, flush=True)
            try:
                stream.close()
            except Exception:
                pass
            time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
