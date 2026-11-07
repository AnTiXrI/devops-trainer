#!/usr/bin/env python3
"""Проверка файла карточек тренажёра.

Запуск:
    python tools/validate.py data/cards.json

Проверяет обязательные поля, диапазон correct_index, число вариантов,
уникальность id и вопросов, отсутствие чувствительных данных.
Возвращает код 0, если ошибок нет.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

REQUIRED = [
    "id", "section", "topic", "question", "options",
    "correct_index", "explanation", "source_note", "tags", "needs_review",
]

SENSITIVE = {
    "приватный ключ": re.compile(r"BEGIN [A-Z ]*PRIVATE KEY", re.I),
    "пароль": re.compile(r"password\s*[:=]\s*\S+", re.I),
    "токен": re.compile(r"\b(token|secret)\s*[:=]\s*\S+", re.I),
    "AWS-ключ": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "GitLab-токен": re.compile(r"\bglpat-[A-Za-z0-9_\-]{8,}"),
    "IP-адрес": re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"),
    "URL": re.compile(r"https?://", re.I),
}


def main(argv: list[str]) -> int:
    path = Path(argv[1] if len(argv) > 1 else "data/cards.json")
    if not path.exists():
        print(f"Файл не найден: {path}")
        return 2

    cards = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(cards, list):
        print("Ожидался JSON-массив карточек")
        return 2

    errors: list[str] = []
    warnings: list[str] = []
    ids: list[str] = []
    questions: dict[str, str] = {}

    for i, card in enumerate(cards, 1):
        label = card.get("id") or f"#{i}"
        if not isinstance(card, dict):
            errors.append(f"#{i}: не объект")
            continue

        for field in REQUIRED:
            if field not in card or card[field] in ("", None, []):
                errors.append(f"{label}: пустое или отсутствующее поле {field}")

        opts = card.get("options")
        if not isinstance(opts, list):
            errors.append(f"{label}: options не массив")
        else:
            if len(opts) != 4:
                warnings.append(f"{label}: вариантов {len(opts)}, а не 4")
            if len(set(map(str, opts))) != len(opts):
                errors.append(f"{label}: варианты повторяются")

        ci = card.get("correct_index")
        if not isinstance(ci, int):
            errors.append(f"{label}: correct_index не число")
        elif isinstance(opts, list) and not (0 <= ci < len(opts)):
            errors.append(f"{label}: correct_index={ci} вне диапазона")

        if not isinstance(card.get("needs_review"), bool):
            errors.append(f"{label}: needs_review не bool")
        elif card["needs_review"] and not card.get("question_to_check"):
            warnings.append(f"{label}: needs_review без question_to_check")

        if not isinstance(card.get("tags"), list) or not card.get("tags"):
            errors.append(f"{label}: tags пустой")

        blob = json.dumps(card, ensure_ascii=False)
        for name, rx in SENSITIVE.items():
            if rx.search(blob):
                errors.append(f"{label}: найдено потенциально чувствительное — {name}")

        ids.append(str(card.get("id")))
        q = " ".join(str(card.get("question", "")).lower().split())
        if q in questions:
            errors.append(f"{label}: дубль вопроса с {questions[q]}")
        else:
            questions[q] = label

        if len(str(card.get("question", ""))) > 160:
            warnings.append(f"{label}: длинный вопрос ({len(str(card.get('question')))} символов)")

    for dup in [i for i, n in Counter(ids).items() if n > 1]:
        errors.append(f"ДУБЛЬ id: {dup}")

    sections = Counter(str(c.get("section")) for c in cards)
    difficulty = Counter(str(c.get("difficulty")) for c in cards)
    reviewed = [c.get("id") for c in cards if c.get("needs_review") is True]

    print(f"Файл: {path}")
    print(f"Карточек: {len(cards)} | разделов: {len(sections)} | needs_review: {len(reviewed)}")
    print("\nРазделы:")
    for name, count in sections.most_common():
        print(f"  {count:>3}  {name}")
    print("\nСложность: " + ", ".join(f"{k}={v}" for k, v in sorted(difficulty.items())))

    if reviewed:
        print("\nneeds_review: " + ", ".join(str(x) for x in reviewed))

    if warnings:
        print(f"\nПредупреждения ({len(warnings)}):")
        for w in warnings:
            print("  ~", w)

    if errors:
        print(f"\nОшибки ({len(errors)}):")
        for e in errors:
            print("  !", e)
        return 1

    print("\nОшибок нет.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
