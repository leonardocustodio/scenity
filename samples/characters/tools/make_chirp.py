# SPDX-License-Identifier: Apache-2.0
"""Make the chirp sound of the characters sample. Own work, CC0.

The script writes a short "beep-boop" of the robot as a WAV file: two sine tones (880 Hz, then 1320 Hz), each with a
short attack and release, mono, 16-bit PCM at 11025 Hz. The script uses only the Python standard library, so each run
writes the same bytes.

Run from the repo root:
    python3 samples/characters/tools/make_chirp.py --out samples/characters/assets/sources/Chirp/chirp.wav
"""

import argparse
import math
import struct

RATE = 11025
# The parts of the sound: the frequency in Hz (0 is silence) and the length in seconds.
PARTS = [(880.0, 0.09), (0.0, 0.03), (1320.0, 0.12)]
# The length of the attack and of the release of each tone, in seconds.
EDGE = 0.012
LEVEL = 0.45


def tone(frequency: float, seconds: float) -> list[int]:
    """Give the samples of one part: a sine with a linear attack and release."""
    count = round(RATE * seconds)
    edge = round(RATE * EDGE)
    samples = []
    for index in range(count):
        if frequency == 0.0:
            samples.append(0)
            continue
        gain = min(1.0, index / edge, (count - 1 - index) / edge)
        value = LEVEL * gain * math.sin(2.0 * math.pi * frequency * index / RATE)
        samples.append(round(value * 32767))
    return samples


def wav_bytes(samples: list[int]) -> bytes:
    """Give a mono 16-bit PCM WAV file of the samples."""
    data = struct.pack(f"<{len(samples)}h", *samples)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(data),
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        RATE,
        RATE * 2,
        2,
        16,
        b"data",
        len(data),
    )
    return header + data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, help="the WAV file to write")
    args = parser.parse_args()
    samples = [value for frequency, seconds in PARTS for value in tone(frequency, seconds)]
    with open(args.out, "wb") as file:
        file.write(wav_bytes(samples))


if __name__ == "__main__":
    main()
