"""Optional: download the trained LoRA from Tinker and convert it to a PEFT adapter for local serving.

    python ml/download_adapter.py [--path tinker://.../sampler_weights/...] [--out ml/results/adapter]

Uses tinker_cookbook.weights.download (signed checkpoint-archive URL via the Tinker REST API) and
weights.build_lora_adapter (-> PEFT format loadable by vLLM `--lora-modules` / SGLang / PEFT).
Adapter files are large-ish (~150-300 MB at rank 32) and gitignored by default (ml/results/adapter*).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.common import RESULTS, STUDENT_MODEL, require_tinker_key, utf8_stdout


def main() -> None:
    utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default=None)
    ap.add_argument("--out", default=str(RESULTS / "adapter"))
    ap.add_argument("--peft", action="store_true", help="also convert to PEFT format (<out>-peft)")
    args = ap.parse_args()
    require_tinker_key()
    from tinker_cookbook import weights

    path = args.path or (RESULTS / "model_path.txt").read_text().strip()
    d = weights.download(tinker_path=path, output_dir=args.out)
    print("downloaded Tinker adapter to", d)
    if args.peft:
        out = args.out.rstrip("/\\") + "-peft"
        weights.build_lora_adapter(base_model=STUDENT_MODEL, adapter_path=d, output_path=out)
        print("PEFT adapter written to", out)


if __name__ == "__main__":
    main()
