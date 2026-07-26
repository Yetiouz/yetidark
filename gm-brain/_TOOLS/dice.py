#!/usr/bin/env python3
"""
Shadowdark dice roller — the single source of truth for randomness in this
campaign. Every check, attack, damage roll, and random-table lookup should
go through this script rather than being narrated/asserted, so results are
real and auditable.

Usage:
  python3 dice.py <notation> [--adv|--disadv] [--reason "why this roll"]

Examples:
  python3 dice.py 1d20+2                     -> straight check, +2 modifier
  python3 dice.py 1d20+3 --adv                -> advantage: roll twice, keep higher
  python3 dice.py 1d20+1 --disadv             -> disadvantage: roll twice, keep lower
  python3 dice.py 2d6+1                       -> damage roll, e.g. bastard sword
  python3 dice.py 1d8+1d4+2                   -> multi-die-type damage (e.g. sneak attack add-on)
  python3 dice.py 1d100                       -> d100 table lookup roll
  python3 dice.py 1d20+2 --reason "Amriel spellcasting check, Magic Missile"

Notation: one or more terms combined with + or -, each term either NdM (N
dice, M sides; N defaults to 1, e.g. "d20") or a flat integer, e.g.
"1d8+1d4+2" or "2d6-1". --adv/--disadv only apply to a single 1d20 term
(with optional flat modifiers), matching the actual rule.

Every roll is auto-checked for a natural 20 / natural 1 on a lone d20 term
(the standard Shadowdark "check" die) and flagged in the output. Every roll
is also appended to dice_log.txt next to this script, so results stay
auditable after the terminal scrolls away.
"""
import argparse
import datetime
import random
import re
import sys
from pathlib import Path

TERM_RE = re.compile(r"([+-]?)\s*(\d*d\d+|\d+)", re.IGNORECASE)
LOG_PATH = Path(__file__).resolve().parent / "dice_log.txt"


class DiceTerm:
    def __init__(self, sign, count, sides):
        self.sign = sign  # +1 or -1
        self.count = count  # None for flat integers
        self.sides = sides  # None for flat integers


def parse_expression(notation: str):
    """Parse an expression like '1d8+1d4+2' into a list of DiceTerm."""
    cleaned = notation.strip().lower().replace(" ", "")
    if not cleaned:
        raise ValueError("Empty dice notation.")
    matches = list(TERM_RE.finditer(cleaned))
    if not matches:
        raise ValueError(f"Bad dice notation: {notation!r}")
    # Verify the matches cover the whole string contiguously (catches garbage like "1d20x2")
    rebuilt = "".join(m.group(0) for m in matches)
    if rebuilt != cleaned:
        raise ValueError(f"Bad dice notation: {notation!r} (expected e.g. 1d20+2, 2d6, 1d8+1d4+2, d100)")

    terms = []
    for m in matches:
        sign = -1 if m.group(1) == "-" else 1
        token = m.group(2)
        if "d" in token:
            count_str, sides_str = token.split("d", 1)
            count = int(count_str) if count_str else 1
            sides = int(sides_str)
            if count < 1 or sides < 2:
                raise ValueError(f"Bad dice term: {token!r}")
            terms.append(DiceTerm(sign, count, sides))
        else:
            terms.append(DiceTerm(sign, None, int(token)))
    return terms


def roll_terms(terms):
    """Roll all terms once. Returns (total, breakdown_str, lone_d20_raw_or_None)."""
    total = 0
    parts = []
    lone_d20_raw = None
    d20_term_count = sum(1 for t in terms if t.sides == 20 and t.count == 1)
    for t in terms:
        if t.count is None:
            total += t.sign * t.sides
            parts.append(f"{'+' if t.sign > 0 else '-'}{t.sides}")
        else:
            rolls = [random.randint(1, t.sides) for _ in range(t.count)]
            subtotal = sum(rolls)
            total += t.sign * subtotal
            sign_str = "+" if t.sign > 0 else "-"
            parts.append(f"{sign_str}{t.count}d{t.sides}{rolls}")
            if t.sides == 20 and t.count == 1 and d20_term_count == 1:
                lone_d20_raw = rolls[0]
    breakdown = " ".join(parts)
    if breakdown.startswith("+"):
        breakdown = breakdown[1:]
    return total, breakdown, lone_d20_raw


def is_single_d20(terms):
    dice_terms = [t for t in terms if t.count is not None]
    return len(dice_terms) == 1 and dice_terms[0].count == 1 and dice_terms[0].sides == 20 and dice_terms[0].sign > 0


def crit_flag(raw):
    if raw is None:
        return None
    if raw == 20:
        return "CRITICAL HIT! (natural 20)"
    if raw == 1:
        return "CRITICAL FAILURE! (natural 1)"
    return None


def log_roll(notation, mode, reason, result_line):
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            ts = datetime.datetime.now().isoformat(timespec="seconds")
            reason_str = f" | {reason}" if reason else ""
            f.write(f"[{ts}] {notation} ({mode}){reason_str} -> {result_line}\n")
    except OSError:
        pass  # logging is best-effort; never block a roll on a filesystem hiccup


def main():
    ap = argparse.ArgumentParser(description="Shadowdark dice roller")
    ap.add_argument("notation", help="Dice notation, e.g. 1d20+2, 2d6, 1d8+1d4+2, d100")
    ap.add_argument("--adv", action="store_true", help="Roll with advantage (single d20 checks only): roll twice, keep higher")
    ap.add_argument("--disadv", action="store_true", help="Roll with disadvantage (single d20 checks only): roll twice, keep lower")
    ap.add_argument("--reason", default=None, help="What this roll is for (echoed in output and the log)")
    args = ap.parse_args()

    if args.adv and args.disadv:
        print("Cannot use both --adv and --disadv.", file=sys.stderr)
        sys.exit(1)

    try:
        terms = parse_expression(args.notation)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    if args.reason:
        print(f"Reason: {args.reason}")

    if args.adv or args.disadv:
        if not is_single_d20(terms):
            print("--adv/--disadv only apply to a single 1d20 term plus optional flat modifiers (e.g. 1d20+2).", file=sys.stderr)
            sys.exit(1)
        total_a, breakdown_a, raw_a = roll_terms(terms)
        total_b, breakdown_b, raw_b = roll_terms(terms)
        if args.adv:
            label = "advantage"
            result, breakdown, raw = (total_a, breakdown_a, raw_a) if total_a >= total_b else (total_b, breakdown_b, raw_b)
        else:
            label = "disadvantage"
            result, breakdown, raw = (total_a, breakdown_a, raw_a) if total_a <= total_b else (total_b, breakdown_b, raw_b)
        print(f"Roll ({label}): [{breakdown_a}] vs [{breakdown_b}]")
        print(f"RESULT: {result}")
        flag = crit_flag(raw)
        if flag:
            print(flag)
        result_line = f"RESULT {result}" + (f" [{flag}]" if flag else "")
        log_roll(args.notation, label, args.reason, result_line)
    else:
        result, breakdown, raw = roll_terms(terms)
        print(f"Roll: {breakdown}")
        print(f"RESULT: {result}")
        flag = crit_flag(raw)
        if flag:
            print(flag)
        result_line = f"RESULT {result}" + (f" [{flag}]" if flag else "")
        log_roll(args.notation, "flat", args.reason, result_line)


if __name__ == "__main__":
    main()
