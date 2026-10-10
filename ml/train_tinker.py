"""LoRA SFT of the small student on teacher(+gold) labels via Tinker.

    python ml/train_tinker.py [--epochs 3] [--batch-size 16] [--rank 32] [--lr auto]

- Tokenisation / chat template / loss mask: tinker_cookbook renderer for the student
  (qwen3_5_disable_thinking); loss only on the assistant JSON (TrainOnWhat.LAST_ASSISTANT_MESSAGE).
- LR: tinker_cookbook.hyperparam_utils.get_lr(student) (LoRA-scaled, ~4.9e-4 for Qwen3.5-4B),
  linear decay to 0, AdamW (beta1 .9, beta2 .95, eps 1e-8).
- Logs per-step train NLL + per-epoch held-out NLL to ml/results/train_log.json, saves sampler
  weights and writes the tinker:// path to ml/results/model_path.txt.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.common import (RENDERER_NAME, RESULTS, SPLITS, STUDENT_MODEL, add_spend, make_renderer, price_of, read_jsonl,
                       require_tinker_key, utf8_stdout)


def main() -> None:
    utf8_stdout()
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--lr", type=str, default="auto")
    ap.add_argument("--max-length", type=int, default=1024)
    ap.add_argument("--name", type=str, default="trailtruth-qwen3.5-4b-lora")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    require_tinker_key()

    import tinker
    from tinker_cookbook.hyperparam_utils import get_lr
    from tinker_cookbook.renderers import TrainOnWhat
    from tinker_cookbook.supervised.common import compute_mean_nll
    from tinker_cookbook.supervised.data import conversation_to_datum

    train = read_jsonl(SPLITS / "train.jsonl")
    test = read_jsonl(SPLITS / "test.jsonl")
    if not train:
        raise SystemExit("data/splits/train.jsonl missing - run ml/make_splits.py")
    label_src = train[0]["meta"].get("label_source")
    if label_src != "teacher":
        print(f"WARNING: training on '{label_src}' labels (dry run?)")

    _tok, renderer = make_renderer(STUDENT_MODEL)

    def to_datum(rec):
        return conversation_to_datum(rec["messages"], renderer, args.max_length, TrainOnWhat.LAST_ASSISTANT_MESSAGE)

    train_data = [to_datum(r) for r in train]
    test_data = [to_datum(r) for r in test]
    train_tokens = sum(d.model_input.length for d in train_data)
    lr = get_lr(STUDENT_MODEL) if args.lr == "auto" else float(args.lr)
    steps_per_epoch = math.ceil(len(train_data) / args.batch_size)
    total_steps = steps_per_epoch * args.epochs
    est_usd = train_tokens * args.epochs * price_of(STUDENT_MODEL)["train"] / 1e6
    print(f"student={STUDENT_MODEL} renderer={RENDERER_NAME} rank={args.rank} lr={lr:.2e} "
          f"train={len(train_data)} test={len(test_data)} steps={total_steps} "
          f"tokens/epoch={train_tokens} est_train_usd~{est_usd:.3f}")

    service = tinker.ServiceClient()
    tc = service.create_lora_training_client(base_model=STUDENT_MODEL, rank=args.rank, seed=args.seed)

    log = {
        "base_model": STUDENT_MODEL, "renderer": RENDERER_NAME, "lora_rank": args.rank, "learning_rate": lr,
        "lr_schedule": "linear", "batch_size": args.batch_size, "epochs": args.epochs, "steps": 0,
        "train_examples": len(train_data), "test_examples": len(test_data), "label_source": label_src,
        "train_tokens_per_epoch": train_tokens, "loss_curve": [], "test_loss": [],
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    RESULTS.mkdir(parents=True, exist_ok=True)

    def eval_test(step: int) -> None:
        if not test_data:
            return
        lps, ws = [], []
        for i in range(0, len(test_data), 64):
            batch = test_data[i : i + 64]
            out = tc.forward(batch, "cross_entropy").result()
            lps += [o["logprobs"] for o in out.loss_fn_outputs]
            ws += [d.loss_fn_inputs["weights"] for d in batch]
        nll = compute_mean_nll(lps, ws)
        log["test_loss"].append([step, round(nll, 5)])
        print(f"  [eval] step {step}: test NLL {nll:.4f}")

    rng = random.Random(args.seed)
    eval_test(0)
    step = 0
    t0 = time.time()
    for epoch in range(args.epochs):
        order = list(range(len(train_data)))
        rng.shuffle(order)
        for b in range(steps_per_epoch):
            batch = [train_data[i] for i in order[b * args.batch_size : (b + 1) * args.batch_size]]
            if not batch:
                continue
            cur_lr = lr * max(0.0, 1.0 - step / total_steps)
            fwd_f = tc.forward_backward(batch, "cross_entropy")
            opt_f = tc.optim_step(tinker.AdamParams(learning_rate=cur_lr, beta1=0.9, beta2=0.95, eps=1e-8))
            fwd = fwd_f.result()
            opt_f.result()
            nll = compute_mean_nll([o["logprobs"] for o in fwd.loss_fn_outputs],
                                   [d.loss_fn_inputs["weights"] for d in batch])
            step += 1
            log["loss_curve"].append([step, round(nll, 5)])
            if step % 5 == 0 or step == 1:
                print(f"  epoch {epoch + 1} step {step}/{total_steps} lr {cur_lr:.2e} train NLL {nll:.4f} "
                      f"({time.time() - t0:.0f}s)")
        eval_test(step)
        log["steps"] = step
        (RESULTS / "train_log.json").write_text(json.dumps(log, indent=2), encoding="utf-8")

    print("saving sampler weights ...")
    saved = tc.save_weights_for_sampler(name=args.name).result()
    model_path = saved.path
    (RESULTS / "model_path.txt").write_text(model_path + "\n", encoding="utf-8")
    log.update({"model_path": model_path, "finished_at": datetime.now(timezone.utc).isoformat(),
                "wall_seconds": round(time.time() - t0, 1)})
    try:  # also save full state so training can be resumed / extended
        log["state_path"] = tc.save_state(name=args.name + "-state").result().path
    except Exception as e:  # noqa: BLE001
        log["state_path_error"] = repr(e)[:200]
    (RESULTS / "train_log.json").write_text(json.dumps(log, indent=2), encoding="utf-8")
    fwd_tokens = sum(d.model_input.length for d in test_data) * (args.epochs + 1)
    add_spend("train_tinker", {"model": STUDENT_MODEL, "train_tokens": train_tokens * args.epochs,
                               "eval_forward_tokens": fwd_tokens,
                               "est_usd": round((train_tokens * args.epochs + fwd_tokens)
                                                * price_of(STUDENT_MODEL)["train"] / 1e6, 4)})
    print(f"done. model_path={model_path}")


if __name__ == "__main__":
    main()
