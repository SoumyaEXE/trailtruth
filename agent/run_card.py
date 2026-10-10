"""Start a TrailCardWorkflow and narrate its progress until it completes.

    python -m agent.run_card havo chch yell
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from agent.config import setup_logging, temporal_client
from agent.runs import get_run, start_card_workflow

ICON = {"pending": "  ", "running": "..", "retrying": "!!", "completed": "OK", "failed": "XX"}


def fmt_step(s: dict) -> str:
    line = f"  [{ICON.get(s['status'], '?')}] {s['name']:<22} {s['status']:<9} attempt={s['attempt']}"
    if s.get("detail"):
        line += f"  {s['detail']}"
    if s.get("error") and s["status"] in ("retrying", "failed", "completed"):
        line += f"\n         -> {s['error']}"
    return line


async def watch(client, wid: str, out=print, poll: float = 0.5, timeout: float = 300) -> dict:
    last = None
    t0 = time.time()
    while True:
        run = await get_run(client, wid)
        sig = json.dumps([(s["name"], s["status"], s["attempt"], s.get("detail"), s.get("error"))
                          for s in run["steps"]])
        if sig != last:
            last = sig
            out(f"--- t+{time.time() - t0:5.1f}s  workflow={run['status']}")
            for s in run["steps"]:
                out(fmt_step(s))
        if run["status"] != "running" or time.time() - t0 > timeout:
            return run
        await asyncio.sleep(poll)


def print_card(card: dict, out=print) -> None:
    out("")
    out(f"=== TRAIL CARD {card['id']}  (week of {card['week_of']})  OVERALL: {card['overall'].upper()} ===")
    for p in card["parks"]:
        out(f"  {p['park_name']} [{p['decision'].upper()}]")
        out(f"    {p['headline']}")
        if p["closed_trails"]:
            out(f"    closed: {', '.join(p['closed_trails'])}")
        for w in p["watch_for"]:
            out(f"    watch for: {w}")
    out(f"  model: {card['model']}   workflow: {card['workflow_id']}")


async def main_async(parks: list[str]) -> int:
    client = await temporal_client()
    wid = await start_card_workflow(client, parks)
    print(f"started TrailCardWorkflow id={wid} parks={parks}")
    run = await watch(client, wid)
    if run.get("card"):
        print_card(run["card"])
    return 0 if run["status"] == "completed" else 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("parks", nargs="+")
    args = ap.parse_args()
    setup_logging("client")
    sys.exit(asyncio.run(main_async([p.lower() for p in args.parks])))


if __name__ == "__main__":
    main()
