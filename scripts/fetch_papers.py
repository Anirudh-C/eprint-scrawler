#!/usr/bin/env python3
"""Fetch new/updated papers from the IACR ePrint RSS feed, classify them by
topic using the keyword rules in topics.json, and upsert them into
docs/data/papers.json for the static site to render.

Uses only the Python standard library, so the GitHub Actions workflow that
runs this needs no dependency-install step.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

FEED_URL = "https://eprint.iacr.org/rss/rss.xml"
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
TOPICS_PATH = SCRIPT_DIR / "topics.json"
DATA_PATH = ROOT / "docs" / "data" / "papers.json"

DC_NS = "http://purl.org/dc/elements/1.1/"


def fetch_feed(url: str = FEED_URL, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "paper-search-bot/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def eprint_id(link: str) -> str:
    """Pull the '2026/223' style id out of an eprint.iacr.org URL."""
    match = re.search(r"(\d{4}/\d+)/?$", link.strip())
    return match.group(1) if match else link.strip()


def parse_pub_date(raw: str) -> str | None:
    """Return an ISO-8601 string (for sorting/display), or None if unparsable."""
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def parse_items(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    items = []
    for item in root.iter("item"):
        link = (item.findtext("link") or "").strip()
        if not link:
            continue
        raw_date = (item.findtext("pubDate") or "").strip()
        items.append(
            {
                "id": eprint_id(link),
                "title": (item.findtext("title") or "").strip(),
                "abstract": (item.findtext("description") or "").strip(),
                "authors": [
                    creator.text.strip()
                    for creator in item.findall(f"{{{DC_NS}}}creator")
                    if creator.text and creator.text.strip()
                ],
                "pub_date": raw_date,
                "pub_date_iso": parse_pub_date(raw_date),
                "iacr_category": (item.findtext("category") or "").strip(),
                "link": link,
            }
        )
    return items


def load_topics() -> dict[str, list[str]]:
    with open(TOPICS_PATH, encoding="utf-8") as f:
        return json.load(f)


def _keyword_pattern(keyword: str) -> re.Pattern:
    # \b...\b so short keywords (e.g. "mpc", "stark") don't match as a
    # substring of an unrelated longer word, but still match regardless of
    # surrounding punctuation/whitespace.
    return re.compile(rf"\b{re.escape(keyword.lower())}\b")


def classify(paper: dict, topics: dict[str, list[str]]) -> list[str]:
    haystack = f"{paper['title']} {paper['abstract']}".lower()
    matched = [
        topic
        for topic, keywords in topics.items()
        if any(_keyword_pattern(kw).search(haystack) for kw in keywords)
    ]
    return matched or ["Uncategorized"]


def load_existing() -> dict[str, dict]:
    if not DATA_PATH.exists():
        return {}
    with open(DATA_PATH, encoding="utf-8") as f:
        payload = json.load(f)
    return {p["id"]: p for p in payload.get("papers", [])}


def save(papers_by_id: dict[str, dict]) -> None:
    papers = sorted(
        papers_by_id.values(),
        key=lambda p: p.get("pub_date_iso") or "",
        reverse=True,
    )
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "papers": papers,
    }
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> int:
    topics = load_topics()
    existing = load_existing()

    try:
        xml_bytes = fetch_feed()
    except Exception as exc:  # network hiccups shouldn't crash the scheduled run loudly
        print(f"Failed to fetch feed: {exc}", file=sys.stderr)
        return 1

    added, updated = 0, 0
    for paper in parse_items(xml_bytes):
        paper["topics"] = classify(paper, topics)
        prior = existing.get(paper["id"])
        if prior is None:
            added += 1
        elif prior.get("title") != paper["title"] or prior.get("abstract") != paper["abstract"]:
            updated += 1
        existing[paper["id"]] = paper

    save(existing)
    print(f"Fetched feed: {added} new, {updated} updated, {len(existing)} total stored.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
