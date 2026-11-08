#!/usr/bin/env python3
"""Single-source rules index for AGENTS.md / CLAUDE.md.

Rules live in one or more guideline Markdown files as ``### <title>（SEVERITY）`` headings
(ASCII parentheses also accepted), optionally followed by ``<!-- ID -->`` when the rule is
also carried by an AI-reviewer styleguide.  From those files this script:

1. renders the title-only rule list and writes it between ``<!-- BEGIN GENERATED RULES -->``
   and ``<!-- END GENERATED RULES -->`` in every SYNC_TARGET (the always-loaded file, which
   is the only place an agent sees the rule unprompted);
2. optionally writes INDEX_OUTPUT, a standalone snapshot so a rule's add/remove is one diff line;
3. checks title uniqueness, ID uniqueness, and ID／severity agreement with STYLEGUIDE.

It never compares rule bodies: the guideline and the styleguide are prose written for
different readers.  Pure standard library.

Usage:
    rules_index.py [--repo DIR] [--config FILE]            # generate / update
    rules_index.py [--repo DIR] [--config FILE] --check    # verify only, no writes
    rules_index.py [--repo DIR] [--config FILE] --list     # print every rule with file:line

Config file ``<repo>/.agent-rules.conf`` (``--config`` overrides), one ``KEY=VALUE`` per
line, ``#`` comments, never sourced:
    SOURCES=docs/guideline_a.md|Label A, docs/guideline_b.md|Label B   (required)
    SYNC_TARGETS=AGENTS.md                                             (default AGENTS.md)
    INDEX_OUTPUT=docs/rules-index.md                                   (default: not written)
    STYLEGUIDE=.gemini/styleguide.md                                   (default: no ID check)
    STYLEGUIDE_RE=<regex with named groups rid and severity>           (default below)
    TRACKED_PREFIXES=D,S,W      (styleguide IDs with other prefixes are ignored)
    SEVERITIES=CRITICAL,HIGH,MEDIUM,LOW

Exit code: 0 clean (or written); 1 problems found, --check drift, or a config／path error (message on stderr).
"""

from __future__ import annotations

import argparse
import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path

BEGIN_MARK = "<!-- BEGIN GENERATED RULES -->"
END_MARK = "<!-- END GENERATED RULES -->"
DEFAULT_SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
# **W-1 — Extract widgets as classes…** *(MEDIUM)*  (bold may end before the severity)
DEFAULT_STYLEGUIDE_RE = r"^\*\*(?P<rid>[A-Z]+-\d+) — [^*]*\*\*[^(]*\((?P<severity>[A-Z]+)"
SECTION_RE = re.compile(r"^## (?P<section>.+?)\s*$")
KNOWN_KEYS = {
    "SOURCES", "SYNC_TARGETS", "INDEX_OUTPUT", "STYLEGUIDE", "STYLEGUIDE_RE",
    "TRACKED_PREFIXES", "SEVERITIES",
}


@dataclass
class Rule:
    source: str
    section: str
    title: str
    severity: str
    rule_id: str | None
    line: int


@dataclass
class Config:
    sources: list[tuple[str, str]]
    sync_targets: list[str]
    index_output: str | None
    styleguide: str | None
    styleguide_re: re.Pattern[str]
    tracked_prefixes: set[str]
    severities: tuple[str, ...]

    @property
    def rule_re(self) -> re.Pattern[str]:
        sev = "|".join(re.escape(s) for s in self.severities)
        return re.compile(
            r"^### (?P<title>.+?)[（(](?P<severity>%s)[）)]"
            r"(?:\s*<!--\s*(?P<rid>[A-Z]+-\d+)\s*-->)?\s*$" % sev
        )


def read_config(path: Path) -> Config:
    if not path.exists():
        raise SystemExit(f"找不到設定檔 {path}；至少要有 SOURCES=<path>|<label>[, …]")
    values: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SystemExit(f"{path}:{lineno} 不是 KEY=VALUE：{raw}")
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in KNOWN_KEYS:
            print(f"警告：{path}:{lineno} 未知的鍵 {key}，忽略", file=sys.stderr)
            continue
        values[key] = value.strip()

    sources: list[tuple[str, str]] = []
    for item in filter(None, (s.strip() for s in values.get("SOURCES", "").split(","))):
        if "|" not in item:
            raise SystemExit(f"SOURCES 的每一項要是 <path>|<label>：{item}")
        src, label = (part.strip() for part in item.split("|", 1))
        sources.append((src, label))
    if not sources:
        raise SystemExit("SOURCES 不能為空")

    severities = tuple(
        s.strip() for s in values.get("SEVERITIES", ",".join(DEFAULT_SEVERITIES)).split(",") if s.strip()
    )
    try:
        styleguide_re = re.compile(values.get("STYLEGUIDE_RE", DEFAULT_STYLEGUIDE_RE))
    except re.error as exc:
        raise SystemExit(f"STYLEGUIDE_RE 不合法：{exc}") from exc
    if {"rid", "severity"} - set(styleguide_re.groupindex):
        raise SystemExit("STYLEGUIDE_RE 必須含具名群組 rid 與 severity")

    return Config(
        sources=sources,
        sync_targets=[t.strip() for t in values.get("SYNC_TARGETS", "AGENTS.md").split(",") if t.strip()],
        index_output=values.get("INDEX_OUTPUT") or None,
        styleguide=values.get("STYLEGUIDE") or None,
        styleguide_re=styleguide_re,
        tracked_prefixes={p.strip() for p in values.get("TRACKED_PREFIXES", "").split(",") if p.strip()},
        severities=severities,
    )


def parse_guideline(path: Path, rel: str, cfg: Config) -> tuple[list[Rule], list[str]]:
    rules: list[Rule] = []
    problems: list[str] = []
    section = ""
    rule_re = cfg.rule_re
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = SECTION_RE.match(raw)
        if m:
            section = m.group("section")
            continue
        if not raw.startswith("### "):
            continue
        m = rule_re.match(raw)
        if not m:
            problems.append(
                f"{rel}:{lineno} 規則標題不符格式「### 標題（{'|'.join(cfg.severities)}）」：{raw.strip()}"
            )
            continue
        rules.append(Rule(rel, section, m.group("title").strip(), m.group("severity"), m.group("rid"), lineno))
    return rules, problems


def parse_styleguide(text: str, rel: str, pattern: re.Pattern[str]) -> tuple[dict[str, str], list[str]]:
    found: dict[str, str] = {}
    problems: list[str] = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        m = pattern.match(raw)
        if not m:
            continue
        rid = m.group("rid")
        if rid in found:
            problems.append(f"{rel}:{lineno} 的 {rid} 重複定義")
            continue
        found[rid] = m.group("severity")
    return found, problems


def check_rules(rules: list[Rule], styleguide: dict[str, str] | None, cfg: Config) -> list[str]:
    problems: list[str] = []

    by_title: dict[str, list[Rule]] = {}
    for r in rules:
        by_title.setdefault(r.title, []).append(r)
    for title, hits in sorted(by_title.items()):
        if len(hits) > 1:
            problems.append(f"規則標題「{title}」出現 {len(hits)} 次：" + "、".join(f"{h.source}:{h.line}" for h in hits))

    by_id: dict[str, list[Rule]] = {}
    for r in rules:
        if r.rule_id:
            by_id.setdefault(r.rule_id, []).append(r)
    for rid, hits in sorted(by_id.items()):
        if len(hits) > 1:
            problems.append(f"{rid} 在 guideline 出現 {len(hits)} 次：" + "、".join(f"{h.source}:{h.line}" for h in hits))

    if styleguide is None:
        return problems
    tracked = {
        rid: sev for rid, sev in styleguide.items()
        if not cfg.tracked_prefixes or rid.split("-")[0] in cfg.tracked_prefixes
    }
    for rid in sorted(set(tracked) - set(by_id)):
        problems.append(f"{rid} 在 {cfg.styleguide} 有，但 guideline 沒有對應規則")
    for rid in sorted(set(by_id) - set(tracked)):
        hit = by_id[rid][0]
        problems.append(f"{rid} 在 {hit.source}:{hit.line} 有，但 {cfg.styleguide} 沒有這條")
    for rid in sorted(set(by_id) & set(tracked)):
        hit = by_id[rid][0]
        if hit.severity != tracked[rid]:
            problems.append(
                f"{rid} 的 severity 不一致：{hit.source}:{hit.line} 是 {hit.severity}，{cfg.styleguide} 是 {tracked[rid]}"
            )
    return problems


def render_rule_list(rules: list[Rule], cfg: Config, base_dir: str) -> str:
    lines: list[str] = []
    for source, label in cfg.sources:
        subset = [r for r in rules if r.source == source]
        if not subset:
            continue
        href = posixpath.relpath(source, base_dir)
        lines.append(f"### {label}（[完整說明與範例]({href})）")
        lines.append("")
        current = None
        for r in subset:
            if r.section != current:
                current = r.section
                lines.append(f"**{current}**")
            lines.append(f"- {r.title}（{r.severity}）")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_index(rules: list[Rule], cfg: Config) -> str:
    assert cfg.index_output
    header = (
        "# 規則索引\n\n"
        "<!-- 本檔由 agent-rules skill 的 rules_index.py 產生，不要手動編輯。 -->\n\n"
        f"規則清單快照，共 {len(rules)} 條。它存在的理由只有一個：讓規則的增刪改在 PR diff 裡"
        "是獨立的一行。規則內容請看各自的來源檔，這裡只有標題與 severity。\n\n"
    )
    return header + render_rule_list(rules, cfg, posixpath.dirname(cfg.index_output) or ".")


def locate_block(text: str, rel: str) -> tuple[int, int]:
    begins, ends = text.count(BEGIN_MARK), text.count(END_MARK)
    if begins != 1 or ends != 1:
        raise SystemExit(
            f"{rel} 的生成區塊標記必須恰好各一組，實際是 {begins} 個 {BEGIN_MARK} 與 {ends} 個 {END_MARK}"
        )
    start = text.index(BEGIN_MARK)
    end = text.index(END_MARK) + len(END_MARK)
    if end < start:
        raise SystemExit(f"{rel} 的 {END_MARK} 出現在 {BEGIN_MARK} 之前")
    return start, end


def expected_block(block: str) -> str:
    return f"{BEGIN_MARK}\n\n{block}\n{END_MARK}"


def collect(root: Path, cfg: Config) -> tuple[list[Rule], list[str]]:
    rules: list[Rule] = []
    problems: list[str] = []
    for source, _ in cfg.sources:
        path = root / source
        if not path.exists():
            problems.append(f"找不到 {source}")
            continue
        parsed, issues = parse_guideline(path, source, cfg)
        rules.extend(parsed)
        problems.extend(issues)

    styleguide: dict[str, str] | None = None
    if cfg.styleguide:
        sg_path = root / cfg.styleguide
        if not sg_path.exists():
            problems.append(f"找不到 {cfg.styleguide}")
        else:
            styleguide, issues = parse_styleguide(sg_path.read_text(encoding="utf-8"), cfg.styleguide, cfg.styleguide_re)
            problems.extend(issues)

    problems.extend(check_rules(rules, styleguide, cfg))
    return rules, problems


def planned_writes(root: Path, rules: list[Rule], cfg: Config) -> list[tuple[str, str, str]]:
    """(rel path, current text, new text) for every output file."""
    writes: list[tuple[str, str, str]] = []
    if cfg.index_output:
        p = root / cfg.index_output
        writes.append((cfg.index_output, p.read_text(encoding="utf-8") if p.exists() else "", render_index(rules, cfg)))
    for rel in cfg.sync_targets:
        p = root / rel
        if not p.exists():
            raise SystemExit(f"找不到 {rel}；要先放好 {BEGIN_MARK} 與 {END_MARK} 標記")
        text = p.read_text(encoding="utf-8")
        start, end = locate_block(text, rel)
        block = render_rule_list(rules, cfg, posixpath.dirname(rel) or ".")
        writes.append((rel, text, text[:start] + expected_block(block) + text[end:]))
    return writes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".", help="repo 根目錄（預設 cwd）")
    ap.add_argument("--config", help="設定檔路徑（預設 <repo>/.agent-rules.conf）")
    ap.add_argument("--check", action="store_true", help="只檢查，不寫檔；輸出不同步時以 1 結束")
    ap.add_argument("--list", action="store_true", help="列出每條規則：severity\\tID\\t來源:行\\t標題")
    args = ap.parse_args(argv)

    root = Path(args.repo).resolve()
    cfg = read_config(Path(args.config) if args.config else root / ".agent-rules.conf")
    rules, problems = collect(root, cfg)

    if args.list:
        for r in rules:
            print(f"{r.severity}\t{r.rule_id or '-'}\t{r.source}:{r.line}\t{r.title}")
        print(f"SUMMARY rules={len(rules)} with_id={sum(1 for r in rules if r.rule_id)} problems={len(problems)}")

    if problems:
        print("規則檢查失敗：", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    if args.list:
        return 0

    writes = planned_writes(root, rules, cfg)
    if args.check:
        stale = [rel for rel, cur, new in writes if cur != new]
        if stale:
            print("以下輸出與來源不同步，重跑本腳本（不帶 --check）：", file=sys.stderr)
            for rel in stale:
                print(f"  - {rel}", file=sys.stderr)
            return 1
        print(f"OK：{len(rules)} 條規則，{len(writes)} 個輸出同步")
        return 0

    for rel, cur, new in writes:
        if cur != new:
            (root / rel).write_text(new, encoding="utf-8")
            print(f"已更新 {rel}")
        else:
            print(f"未變更 {rel}")
    print(f"{len(rules)} 條規則")
    return 0


if __name__ == "__main__":
    sys.exit(main())
