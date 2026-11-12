#!/usr/bin/env python3
# Runs a Hugging Face Space batch (template hf_space_fibo2_t2i) from
# art/runs/batch-<n>.json, one item at a time.
#
#   uv run --no-project --with gradio_client --with pillow python -I art/tools/run-space.py <n> --inbox art/inbox [--only <id>,<id>]
#
# It calls only Bria's Space, briaai/Fibo-2.0-T2I, at /generate_image; any
# other needs --allow-space. The inbox must sit inside art/inbox, which git
# ignores, and each item's name must be a slug. A call that runs past 300 s is
# cancelled and counts as a failure.
#
# gradio_client signs each call with this Mac account's saved Hugging Face
# login (`hf auth login`), so ZeroGPU counts the call against that account's
# quota. This script never reads the token. Each output is checked for its
# maker's provenance (C2PA, EXIF or XMP), then saved as <inbox>/batch-<n>/<id>.png
# for make-finals.mjs. An output that carries provenance is kept as it came and
# the run stops, since a re-encode would drop it (art/LICENSES.md, Duties).
# Exit 0 every item saved, 1 a call failed or timed out, 2 usage error or a
# refused batch, 3 an output carries provenance.

import argparse
import json
import pathlib
import re
import shutil
import struct
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
INBOX = ROOT / "art" / "inbox"
TEMPLATE = "hf_space_fibo2_t2i"
SPACE = "briaai/Fibo-2.0-T2I"
API = "/generate_image"
TIMEOUT = 300  # seconds; the Space reserves 120 s of GPU a call and measures about 90 s
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def chunk_ids(data):
    """The chunk types of a PNG or WebP file, or None for another format."""
    ids = []
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        at = 8
        while at + 12 <= len(data):
            (size,) = struct.unpack(">I", data[at : at + 4])
            kind = data[at + 4 : at + 8].decode("latin-1")
            if kind == "iTXt" and data[at + 8 : at + 26] == b"XML:com.adobe.xmp\0":
                kind = "XMP"
            ids.append(kind)
            at += 12 + size
        return ids
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        at = 12
        while at + 8 <= len(data):
            (size,) = struct.unpack("<I", data[at + 4 : at + 8])
            ids.append(data[at : at + 4].decode("latin-1").strip())
            at += 8 + size + (size % 2)
        return ids
    return None


# C2PA travels in caBX (PNG) or a C2PA chunk (WebP); EXIF and XMP as named.
PROVENANCE = {"caBX", "C2PA", "eXIf", "EXIF", "XMP"}


def refusals(req, inbox, allow_space):
    """Why this batch must not run, before any client loads: [] when it may."""
    problems = []
    if req.get("template") != TEMPLATE:
        problems.append(f"not a {TEMPLATE} batch")
    try:
        inbox.resolve().relative_to(INBOX.resolve())
    except ValueError:
        problems.append(f"--inbox must be inside {INBOX.relative_to(ROOT)}, which git ignores")
    for item in req.get("items", []):
        name = str(item.get("description", ""))
        if not SLUG.match(name):
            problems.append(f"item name {name!r} is not a slug")
        if item.get("space") != SPACE and not allow_space:
            problems.append(f"{name}: Space {item.get('space')!r} is not {SPACE}; pass --allow-space to run it")
        if item.get("api_name") != API:
            problems.append(f"{name}: endpoint {item.get('api_name')!r} is not {API}")
    return problems


def main():
    parser = argparse.ArgumentParser(description="Run a Hugging Face Space art batch.")
    parser.add_argument("batch", type=int)
    parser.add_argument("--inbox", required=True)
    parser.add_argument("--only", default="")
    parser.add_argument("--allow-space", action="store_true")
    parser.add_argument("--request", help="a request file other than art/runs/batch-<n>.json, for tests")
    args = parser.parse_args()

    req_path = pathlib.Path(args.request) if args.request else ROOT / "art" / "runs" / f"batch-{args.batch}.json"
    req = json.loads(req_path.read_text())
    problems = refusals(req, pathlib.Path(args.inbox), args.allow_space)
    only = {s for s in args.only.split(",") if s}
    items = [i for i in req.get("items", []) if not only or i["description"] in only]
    unknown = only - {i.get("description") for i in req.get("items", [])}
    if unknown or not items:
        problems.append(f"no such items: {', '.join(sorted(unknown)) or '(none selected)'}")
    if problems:
        for p in problems:
            print(f"run-space: {p}", file=sys.stderr)
        return 2

    from gradio_client import Client
    from PIL import Image

    out_dir = pathlib.Path(args.inbox) / f"batch-{args.batch}"
    out_dir.mkdir(parents=True, exist_ok=True)
    clients = {}
    failed = 0
    for item in items:
        name = item["description"]
        clients.setdefault(item["space"], Client(item["space"], verbose=False))
        started = time.time()
        job = clients[item["space"]].submit(**item["inputs"], inspire_image=None, api_name=item["api_name"])
        try:
            image, seed, _caption = job.result(timeout=TIMEOUT)
        except TimeoutError:
            job.cancel()
            print(f"run-space: FAIL {name}: no result in {TIMEOUT} s; cancelled", file=sys.stderr)
            failed += 1
            continue
        except Exception as err:  # the Space reports quota and GPU errors as exceptions
            print(f"run-space: FAIL {name}: {err}", file=sys.stderr)
            failed += 1
            continue
        path = pathlib.Path(image["path"] if isinstance(image, dict) else image)
        data = path.read_bytes()
        ids = chunk_ids(data)
        found = sorted(PROVENANCE & set(ids or []))
        if found:
            kept = out_dir / f"{name}{path.suffix}"
            shutil.copyfile(path, kept)
            print(f"run-space: {name} carries {', '.join(found)} from its maker; kept as {kept}, nothing converted", file=sys.stderr)
            return 3
        if int(seed) != item["inputs"]["seed"]:
            print(f"run-space: FAIL {name}: the Space ran seed {seed}, not {item['inputs']['seed']}", file=sys.stderr)
            failed += 1
            continue
        with Image.open(path) as im:
            im.save(out_dir / f"{name}.png")
            size = im.size
        print(f"run-space: ok {name} {size[0]} x {size[1]}, {path.suffix[1:]} with chunks {ids}, {time.time() - started:.0f} s", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
