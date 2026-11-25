#!/usr/bin/env python3
"""Mechanical checks for the writing-principles skill.

Scans the Markdown files of one repository and reports, per principle, the lines
that break a machine-checkable rule (see SKILL.md, section "原則與判定").
Pure standard library; no ripgrep needed.

Usage:
    check_docs.py [--repo DIR] [--config FILE] [--exclude GLOB ...] [--heading-ref "PATH [RE]"] ... [FILE ...]

Exit code: 0 no FAIL item, 1 at least one FAIL item, 2 usage or environment error.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional, Tuple
from urllib.parse import unquote

DEFAULT_TYPES = ("接入指南", "參考", "說明", "流程", "規則", "入口")
GUIDE_TYPE = "接入指南"
EXPLAIN_TYPE = "說明"

HISTORY_WORDS = r"原本|後來改成|後來改為|之前是|舊版|曾經|已改為|改版前|不再支援|取代了"
TIME_WORDS = r"目前|現在|最新|最近|即將|未來|之後會|將會|預計|規劃中|待實作|暫時|新增的|全新"
# Compounds that contain a trigger word but are ordinary prose (e.g. 出現在), stripped before the
# p2／p3 match. Off by default: a project opts in through IGNORE_WORDS in its config file.
IGNORE_WORDS = ""
ALLOW_MARKER = "<!-- allow-time-word -->"
GUIDE_BAD_H2 = ("設計", "架構", "為什麼", "決策", "取捨")
COPY_PREFIX = "> 本文件為副本"
COPY_LINE_RE = re.compile(
    r"^> 本文件為副本，權威版：\[[^\]]+\]\([^)]+\)。副本同步日：\d{4}-\d{2}-\d{2}。$"
)

# Ticket-like tokens that are not tickets.  Only used with the generic pattern.
NON_TICKET_PREFIXES = frozenset(
    "ISO RFC SHA UTF CVE IEEE TLS SSL HTTP AES UTC GMT ECMA OAUTH PKCE ES EN DIN BS X "
    "ID API URL UUID GUID USB HDMI PCI MD".split()
)
# ASCII-aware boundaries: Python's \b treats CJK as word characters, so "見PROJ-7" would not match.
DEFAULT_TICKET_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,9}-[0-9]+(?![A-Za-z0-9])")
COMMIT_LINK_RE = re.compile(r"commit/[0-9a-f]{7,}|blob/[0-9a-f]{7,40}")
HEX_RE = re.compile(r"(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])")

GUIDE_PHRASE_RE = re.compile(r"同上|如前述|請參考|見〈")
GUIDE_EXEMPT_H2_RE = re.compile(r"參考|下一步|延伸閱讀|相關文件|Next")

UNRELEASED_HIT_RE = re.compile(
    r"尚未發版|尚未發佈|未發佈|未發版|僅 main|(?i:only on main|unreleased)|未釋出"
)
# 別份文件以區段名指稱 CHANGELOG 的未發版區段：區段名放在反引號、「」或〈〉內，緊接區段／節／標題／section／heading。
UNRELEASED_SECTION_REF_RE = re.compile(
    r"(`[^`]+`|「[^」]+」|〈[^〉]+〉)\s*(?:區段|(?:章|小)?節|標題|(?i:section|heading))"
)

EVIDENCE_TRIGGER_RE = re.compile(
    r"實測|驗證過|已測|測過|有測|未測|沒測|應該可以|理論上|預期可|未驗(?!簽)|推論|讀碼"
)
# 唯一放行的「讀碼」寫法是動詞片語（「主 checkout 只用來讀碼、git pull」）：比對觸發詞前先剔除，而且片語要在
# 標點、空白、「的」或行尾結束才剔除，「用來讀碼確認結果會成功」「用來讀碼表明會成功」仍算觸發。「讀碼表」
# 「只靠讀碼」「從讀碼來看」等其他寫法照舊算觸發；不加「讀碼表」之類的剔除，免得「讀碼表明會成功」被切成「明會成功」而漏掉。
EVIDENCE_READ_CODE_VERB_RE = re.compile(r"(?:用來|拿來|用於)讀碼(?=$|[、，。；：）」』\s的])")
# 句尾的出處標示（讀碼：<檔名、符號或章節>）：答「從哪裡看來」，不是證據等級；p8 判定前先剔除，
# 但括號內自己含觸發詞（「（讀碼：推論）」）的不剔除，免得禁用字躲進標示裡。
EVIDENCE_SOURCE_RE = re.compile(r"（讀碼：([^）]+)）")
# 括號內容要像檔名、符號或章節才算出處：反引號、兩個以上英文字母、〈〉、§、「第 N 節／章」、帶點節號，
# 或整個內容就是佔位的 …／...。
EVIDENCE_SOURCE_OK_RE = re.compile(
    r"`|[A-Za-z]{2,}|〈|§|第\s*[\d.]+\s*[節章]|\d+(?:\.\d+)+|^(?:…|\.\.\.)$"
)
EVIDENCE_SOURCE_PLACEHOLDERS = ("…", "...")
# 格式說明裡寫在反引號內的佔位範例，不是證據宣稱；沒有反引號的佔位寫法照舊算 p8。
EVIDENCE_FORMAT_EXAMPLE_RE = re.compile(r"`已實測（(?:YYYY-MM-DD|日期)，環境）`")
EVIDENCE_SOURCE_NOTE = "  （出處標示不是檔名、符號或章節）"
EVIDENCE_OK_TESTED_RE = re.compile(r"已實測（\d{4}-\d{2}-\d{2}，[^）]+）")
EVIDENCE_OK_UNTESTED = "未實測"

VAGUE_LINK_RE = re.compile(r"(請見|詳見|見)(這裡|此處|本文件|該文件)|點此|這份文件|(?i:click here)")
LINE_ANCHOR_RE = re.compile(r"#L[0-9]+")

FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
LIST_RE = re.compile(r"^\s*([-*+]|\d+[.)])\s+")
# PR／issue 範本的路徑（不分大小寫，從 repo 根起算；子目錄下的同名檔不算範本）；範本內的單一勾選項放行（原則 12 例外）。
TEMPLATE_PATH_RE = re.compile(
    r"(?i)^(\.github/(pull_request_template\.md|pull_request_template/[^/]+\.md|issue_template/[^/]+\.md)"
    r"|(docs/)?pull_request_template\.md|\.gitlab/(merge_request_templates|issue_templates)/[^/]+\.md)$"
)
CHECKBOX_ITEM_RE = re.compile(r"^\s*[-*+]\s+\[[ xX]\]\s")
THEMATIC_BREAK_RE = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
CODE_SPAN_RE = re.compile(r"(?<!`)(`+)(?!`)(.*?[^`])?\1(?!`)")
LINK_RE = re.compile(r"\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")
TABLE_SEP_CELL_RE = re.compile(r"^:?-{1,}:?$")

# Reference limits for the p6 hints (hints only; never counted as FAIL).
P6_MAX_PARAGRAPH_SENTENCES = 5
P6_MAX_PARAGRAPH_CHARS = 220
P6_MAX_SENTENCE_CHARS = 80
P6_MAX_CELL_CHARS = 60

CONFIG_KEYS = (
    "TYPES",
    "NO_HEADER",
    "TICKET_RE",
    "UNRELEASED_PHRASE",
    "DOC_HOST_RE",
    "EXCLUDE",
    "HISTORY_WORDS",
    "TIME_WORDS",
    "IGNORE_WORDS",
    "HEADING_REF",
)

# 只列出、不計 FAIL 的清單（render 另印一段，failed 也不算它們）。
LIST_ONLY_IDS = ("p3-allow", "p7-section", "p8-source")

HARD_IDS = (
    "p1", "p1b", "p2", "p3", "p3-allow", "p4t", "p4c", "p5", "p7", "p7a", "p7-section",
    "p8", "p8-source", "p9a", "p9b", "p9c", "p9d", "p11", "p12",
)
HINT_IDS = ("p4h", "p6")
TITLES = {
    "p1": "p1 文件分型：檔頭（讀者／型別）缺漏",
    "p1b": "p1b 文件分型：標題與型別不符",
    "p2": "p2 正文只寫現況：歷史用語",
    "p3": "p3 不用時間性與承諾性用語",
    "p4t": "p4t 正文不放票號",
    "p4c": "p4c 正文不放 commit／blob 連結",
    "p5": "p5 接入指南步驟區不得依賴別份文件",
    "p7": "p7 未發版行為未用固定字樣",
    "p7a": "p7a 未發版 (a) 型位置不符",
    "p7-section": "p7-section 區段名指稱（不計 FAIL）",
    "p8": "p8 證據等級未用兩個固定值",
    "p8-source": "p8-source 帶出處標示但無證據等級的行（不計 FAIL）",
    "p9a": "p9a 含糊連結字",
    "p9b": "p9b 行號錨點",
    "p9c": "p9c 內部連結或 anchor 不存在",
    "p9d": "p9d 以〈標題〉或節號引用的文件標題不存在",
    "p11": "p11 副本頁首格式",
    "p12": "p12 單一項目清單",
}


class Heading(NamedTuple):
    level: int
    text: str
    line: int  # 1-based
    slug: str


def slugify(text: str) -> str:
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text).replace("`", "")
    return re.sub(r"[^\w\- ]", "", text.strip().lower()).replace(" ", "-")


class Doc:
    """One Markdown file, parsed once: lines, fence state, headings."""

    def __init__(self, rel: str, text: str):
        self.rel = rel
        self.lines: List[str] = text.lstrip("﻿").splitlines()
        n = len(self.lines)
        self.in_fence = [False] * n
        self.fence_indent: Dict[int, int] = {}  # first line index of a fence region -> indent
        self.headings: List[Heading] = []
        self.doc_type: Optional[str] = None
        self._parse_fences()
        self._parse_headings()

    def _parse_fences(self) -> None:
        open_char = ""
        open_len = 0
        for i, line in enumerate(self.lines):
            m = FENCE_RE.match(line)
            if not open_char:
                if not m:
                    continue
                fence, info = m.group(2), m.group(3)
                if fence[0] == "`" and "`" in info:
                    continue  # inline code that merely starts with backticks
                open_char, open_len = fence[0], len(fence)
                self.in_fence[i] = True
                self.fence_indent[i] = len(m.group(1))
            else:
                self.in_fence[i] = True
                if (
                    m
                    and m.group(2)[0] == open_char
                    and len(m.group(2)) >= open_len
                    and not m.group(3).strip()
                ):
                    open_char = ""

    def _parse_headings(self) -> None:
        seen: Dict[str, int] = {}
        for i, line in enumerate(self.lines):
            if self.in_fence[i]:
                continue
            m = HEADING_RE.match(line)
            if not m:
                continue
            text = re.sub(r"\s+#+\s*$", "", m.group(2))
            slug = slugify(text)
            count = seen.get(slug, 0)
            seen[slug] = count + 1
            self.headings.append(
                Heading(len(m.group(1)), text, i + 1, slug if count == 0 else f"{slug}-{count}")
            )

    def anchors(self) -> frozenset:
        return frozenset(h.slug for h in self.headings)

    def links(self, index: int) -> List[Tuple[str, str]]:
        """(text, target) of the inline links on one line (callers skip fence lines)."""
        return [(m.group(1), m.group(2)) for m in LINK_RE.finditer(CODE_SPAN_RE.sub("", self.lines[index]))]


def read_doc(path: Path, rel: str) -> Optional[Doc]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return Doc(rel, text)


class HeadingRef(NamedTuple):
    """One HEADING_REF entry: the document whose headings are quoted, plus the two reference shapes."""

    path: str  # relative to the repo root, as written in the config
    title_re: "re.Pattern[str]"  # <前綴>…〈標題〉
    number_re: "re.Pattern[str]"  # <前綴> 節號


class Settings:
    def __init__(self) -> None:
        self.types: List[str] = list(DEFAULT_TYPES)
        self.no_header: List[str] = []
        self.ticket_re: Optional["re.Pattern[str]"] = None
        self.unreleased_phrase: str = ""
        self.doc_host_re: Optional["re.Pattern[str]"] = None
        self.excludes: List[str] = []
        self.history_re = re.compile(HISTORY_WORDS)
        self.time_re = re.compile(TIME_WORDS)
        self.ignore_re: Optional["re.Pattern[str]"] = re.compile(IGNORE_WORDS) if IGNORE_WORDS else None
        self.overrides: List[str] = []
        self.config_path: str = ""
        self.headerless = False
        self.heading_refs: List[HeadingRef] = []

    @property
    def types_re(self) -> "re.Pattern[str]":
        alternatives = "|".join(re.escape(t) for t in self.types)
        return re.compile(rf"^型別：({alternatives})\s*$")


def load_config(path: Path) -> Dict[str, Any]:
    """Key=value lines; a repeated key overwrites, except HEADING_REF which accumulates into a list."""
    config: Dict[str, Any] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in CONFIG_KEYS:
            print(f"警告：{path} 有未知的設定鍵 {key}（已忽略）", file=sys.stderr)
            continue
        if key == "HEADING_REF":
            if value.strip():
                config.setdefault(key, []).append(value.strip())
            continue
        config[key] = value.strip()
    return config


def compile_regex(label: str, pattern: str) -> "re.Pattern[str]":
    try:
        return re.compile(pattern)
    except re.error as exc:
        raise ValueError(f"{label} 不是合法的 regex：{exc}") from exc


HEADING_REF_FORMAT = "格式：<文件路徑> [前綴 regex]"


def parse_heading_ref(value: str) -> HeadingRef:
    parts = value.strip().split(None, 1)
    if not parts:
        raise ValueError(f"HEADING_REF 的值是空的（{HEADING_REF_FORMAT}）")
    path = parts[0][2:] if parts[0].startswith("./") else parts[0]
    prefix = parts[1].strip() if len(parts) > 1 else re.escape(Path(path).name)
    if compile_regex("HEADING_REF", prefix).search(""):
        raise ValueError("HEADING_REF 的前綴 regex 能匹配空字串，會把所有〈〉都當成引用：" + prefix)
    # Named groups so that capturing groups inside the user's prefix cannot shift the numbering.
    title_re = compile_regex(
        "HEADING_REF", rf"(?:{prefix})[^〈\n]{{0,8}}(?P<refs>(?:〈[^〉]+〉[、，和與及或／\s]?){{1,8}})"
    )
    number_re = compile_regex("HEADING_REF", rf"(?:{prefix})\s*(?:第\s*)?(?P<num>\d+(?:\.\d+)*)(?![\d.])")
    return HeadingRef(path, title_re, number_re)


def build_settings(config: Dict[str, Any], args: argparse.Namespace) -> Settings:
    s = Settings()
    s.headerless = args.headerless
    # List-like keys: config and CLI values are merged.  Scalars: CLI wins over config.
    extra_types = [t for t in (config.get("TYPES", "") + "|" + (args.types or "")).split("|") if t.strip()]
    s.types.extend(t.strip() for t in extra_types if t.strip() not in s.types)
    s.no_header = config.get("NO_HEADER", "").split()
    for item in args.no_header or []:
        s.no_header.extend(item.split())
    s.excludes = config.get("EXCLUDE", "").split() + list(args.exclude or [])
    ticket = args.ticket_re if args.ticket_re is not None else config.get("TICKET_RE", "")
    if ticket:
        s.ticket_re = compile_regex("TICKET_RE", ticket)
    phrase = args.unreleased_phrase if args.unreleased_phrase is not None else config.get("UNRELEASED_PHRASE", "")
    s.unreleased_phrase = phrase
    host = args.doc_host_re if args.doc_host_re is not None else config.get("DOC_HOST_RE", "")
    if host:
        s.doc_host_re = compile_regex("DOC_HOST_RE", host)
    if config.get("HISTORY_WORDS"):
        s.history_re = compile_regex("HISTORY_WORDS", config["HISTORY_WORDS"])
    if config.get("TIME_WORDS"):
        s.time_re = compile_regex("TIME_WORDS", config["TIME_WORDS"])
    if "IGNORE_WORDS" in config:
        s.ignore_re = compile_ignore_words(config["IGNORE_WORDS"], s)
    s.overrides = [k for k in ("HISTORY_WORDS", "TIME_WORDS", "IGNORE_WORDS") if config.get(k)]
    # HEADING_REF is list-like: every config line and every --heading-ref adds one document.
    s.heading_refs = [parse_heading_ref(v) for v in list(config.get("HEADING_REF", [])) + list(args.heading_ref or [])]
    return s


def compile_ignore_words(value: str, s: Settings) -> Optional["re.Pattern[str]"]:
    """IGNORE_WORDS is a `|`-separated list of literal compounds, not a regex.

    Every entry must contain a p2／p3 trigger word and be longer than it; otherwise
    an entry such as `.`、`前` or `目前` would silently blank the whole check.
    """
    words = [w.strip() for w in value.split("|") if w.strip()]
    if not words:
        return None
    for w in words:
        hit = s.time_re.search(w) or s.history_re.search(w)
        if not hit or hit.group(0) == w:
            raise ValueError(
                f"IGNORE_WORDS 的「{w}」不是含觸發詞的複合詞（每項必須含 TIME_WORDS／HISTORY_WORDS 的某個詞且比它長）"
            )
    return re.compile("|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)))


# ---------------------------------------------------------------- scope


def git_tracked(repo: Path, pathspec: Optional[str] = None) -> Optional[List[str]]:
    cmd = ["git", "-C", str(repo), "ls-files", "-z"] + (["--", pathspec] if pathspec else [])
    try:
        result = subprocess.run(cmd, capture_output=True, check=False)
    except OSError:
        return None
    if result.returncode != 0:
        return None
    names = [n for n in result.stdout.decode("utf-8", "replace").split("\0") if n]
    return [n for n in names if (repo / n).is_file()]


def git_tracked_markdown(repo: Path) -> Optional[List[str]]:
    return git_tracked(repo, "*.md")


def walk_files(repo: Path) -> List[str]:
    found = []
    for dirpath, dirnames, filenames in os.walk(repo):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_file():
                found.append(path.relative_to(repo).as_posix())
    return found


def walk_markdown(repo: Path) -> List[str]:
    found = []
    for path in repo.rglob("*.md"):
        rel = path.relative_to(repo)
        if ".git" in rel.parts or "node_modules" in rel.parts or not path.is_file():
            continue
        found.append(rel.as_posix())
    return found


def default_scope(repo: Path) -> List[str]:
    """Tracked *.md files; a non-git directory or one with nothing tracked is walked instead."""
    names = git_tracked_markdown(repo)
    if not names:
        names = walk_markdown(repo)
    kept = [n for n in names if "changelog" not in n.lower() and not n.startswith("docs/adr/")]
    return sorted(set(kept))


def p9d_default_scope(repo: Path) -> List[str]:
    """Every tracked file (a non-git directory or one with nothing tracked is walked); changelog／ADR Markdown stays out."""
    names = git_tracked(repo)
    if not names:
        names = walk_files(repo)
    kept = [
        n
        for n in names
        if not (n.lower().endswith(".md") and ("changelog" in n.lower() or n.startswith("docs/adr/")))
    ]
    return sorted(set(kept))


def apply_excludes(names: List[str], globs: List[str]) -> List[str]:
    cleaned = [g[2:] if g.startswith("./") else g for g in globs]
    return [n for n in names if not any(fnmatch.fnmatchcase(n, g) for g in cleaned)]


def resolve_explicit(repo: Path, files: List[str]) -> List[Tuple[str, Path]]:
    resolved = []
    for name in files:
        path = Path(name)
        if not path.is_file() and not path.is_absolute() and (repo / name).is_file():
            path = repo / name
        if not path.is_file():
            raise FileNotFoundError(f"找不到檔案：{name}")
        path = path.resolve()
        try:
            rel = path.relative_to(repo).as_posix()
        except ValueError:
            rel = path.as_posix()
        resolved.append((rel, path))
    return resolved


# ---------------------------------------------------------------- checks


class Report:
    def __init__(self) -> None:
        self.hits: Dict[str, List[Tuple[str, int, str]]] = {k: [] for k in HARD_IDS + HINT_IDS}

    def add(self, key: str, rel: str, line: int, text: str) -> None:
        self.hits[key].append((rel, line, text))

    def count(self, key: str) -> int:
        return len(self.hits[key])


def show(line: str) -> str:
    text = line.strip()
    return text if len(text) <= 160 else text[:160] + "…"


def check_header(doc: Doc, s: Settings, report: Report, exempt: bool) -> None:
    lines = doc.lines
    start = 0
    heading_line = 1
    problem: Optional[Tuple[int, str]] = None
    if not s.headerless:
        h1 = next((h for h in doc.headings if h.level == 1), None)
        if h1 is None:
            problem = (1, "沒有 `# ` 標題，無法定位檔頭")
        else:
            start = h1.line
            heading_line = h1.line
    nonempty = [(i, l) for i, l in enumerate(lines[start:], start) if l.strip()] if problem is None else []
    if nonempty and nonempty[0][1].startswith(COPY_PREFIX):
        nonempty = nonempty[1:]
    if problem is None:
        if not nonempty or not re.match(r"^讀者：\S", nonempty[0][1]):
            offender = nonempty[0] if nonempty else None
            problem = (offender[0] + 1 if offender else heading_line, "標題之下第 1 個非空行不是 `讀者：…`")
        elif len(nonempty) < 2 or not s.types_re.match(nonempty[1][1]):
            offender = nonempty[1] if len(nonempty) > 1 else None
            problem = (
                offender[0] + 1 if offender else nonempty[0][0] + 1,
                "標題之下第 2 個非空行不是 `型別：<" + "|".join(s.types) + ">`",
            )
    if len(nonempty) >= 2:
        m = s.types_re.match(nonempty[1][1])
        if m:
            doc.doc_type = m.group(1)
    if problem is not None and not exempt:
        report.add("p1", doc.rel, problem[0], problem[1])


def check_heading_vs_type(doc: Doc, report: Report) -> None:
    for h in doc.headings:
        if doc.doc_type == GUIDE_TYPE and h.level == 2 and any(w in h.text for w in GUIDE_BAD_H2):
            report.add("p1b", doc.rel, h.line, f"接入指南的 H2 含設計類字眼：{h.text}")
        if doc.doc_type == EXPLAIN_TYPE and h.level in (2, 3) and "步驟" in h.text:
            report.add("p1b", doc.rel, h.line, f"說明的標題含「步驟」：{h.text}")


def check_line_patterns(doc: Doc, s: Settings, report: Report) -> None:
    phrase = s.unreleased_phrase
    for i, line in enumerate(doc.lines):
        n = i + 1
        scrubbed = s.ignore_re.sub("", line) if s.ignore_re else line
        if s.history_re.search(scrubbed):
            report.add("p2", doc.rel, n, show(line))
        if ALLOW_MARKER in line:
            report.add("p3-allow", doc.rel, n, show(line))
        elif s.time_re.search(scrubbed):
            report.add("p3", doc.rel, n, show(line))
        if not line.startswith(COPY_PREFIX):
            if ticket_in(line, s):
                report.add("p4t", doc.rel, n, show(line))
            if COMMIT_LINK_RE.search(line):
                report.add("p4c", doc.rel, n, show(line))
            if HEX_RE.search(line):
                report.add("p4h", doc.rel, n, show(line))
        if UNRELEASED_HIT_RE.search(line):
            if unreleased_section_ref(line):
                report.add("p7-section", doc.rel, n, show(line))
            elif not phrase:
                report.add("p7", doc.rel, n, show(line) + "  （未設定 UNRELEASED_PHRASE）")
            elif not unreleased_ok(line, phrase):
                report.add("p7", doc.rel, n, show(line))
        if not line.startswith("#"):
            check_evidence(doc, n, line, report)
        if VAGUE_LINK_RE.search(line):
            report.add("p9a", doc.rel, n, show(line))
        if LINE_ANCHOR_RE.search(line):
            report.add("p9b", doc.rel, n, show(line))


def ticket_in(line: str, s: Settings) -> bool:
    if s.ticket_re is not None:
        return bool(s.ticket_re.search(line))
    return any(
        m.group(0).rsplit("-", 1)[0] not in NON_TICKET_PREFIXES
        for m in DEFAULT_TICKET_RE.finditer(line)
    )


def strip_source_markers(line: str) -> Tuple[str, bool, bool]:
    """去掉出處標示 `（讀碼：…）`，回傳 (剩下的文字, 有合格的出處標示, 有不合格的出處標示)。

    括號內含 p8 觸發詞的保留，讓它照常被報；內容不像檔名、符號或章節的標示去掉並記為不合格；
    整個內容只是佔位的 …／... 去掉但不算出處（那是格式說明，不是某一行的出處）。
    """
    found = {"valid": False, "bad": False}

    def drop(m: "re.Match[str]") -> str:
        inner = m.group(1)
        if EVIDENCE_TRIGGER_RE.search(inner):
            return m.group(0)
        content = inner.strip()
        if not EVIDENCE_SOURCE_OK_RE.search(content):
            found["bad"] = True
        elif content not in EVIDENCE_SOURCE_PLACEHOLDERS:
            found["valid"] = True
        return ""

    body = EVIDENCE_SOURCE_RE.sub(drop, line)
    return body, found["valid"], found["bad"]


def check_evidence(doc: Doc, n: int, line: str, report: Report) -> None:
    """p8：證據等級只能是 `已實測（YYYY-MM-DD，環境）` 或 `未實測`；另列帶出處標示卻沒標等級的行（p8-source）。"""
    body, has_source, bad_source = strip_source_markers(line)
    body = EVIDENCE_READ_CODE_VERB_RE.sub("", EVIDENCE_FORMAT_EXAMPLE_RE.sub("", body))
    leftover = False
    if EVIDENCE_TRIGGER_RE.search(body):
        rest = EVIDENCE_OK_TESTED_RE.sub("", body).replace(EVIDENCE_OK_UNTESTED, "")
        leftover = bool(EVIDENCE_TRIGGER_RE.search(rest))
    if bad_source:
        report.add("p8", doc.rel, n, show(line) + EVIDENCE_SOURCE_NOTE)
    elif leftover:
        report.add("p8", doc.rel, n, show(line))
    elif has_source and not EVIDENCE_OK_TESTED_RE.search(line) and EVIDENCE_OK_UNTESTED not in line:
        report.add("p8-source", doc.rel, n, show(line))


def unreleased_section_ref(line: str) -> bool:
    """別份文件以區段名指稱未發版區段（例如「寫進 `## Unreleased` 區段」）：區段名本身含未發版字眼。"""
    return any(
        UNRELEASED_HIT_RE.search(m.group(1)) for m in UNRELEASED_SECTION_REF_RE.finditer(line)
    )


def unreleased_ok(line: str, phrase: str) -> bool:
    return line.strip() == f"> {phrase}。" or f"（{phrase}）" in line or f"// {phrase}" in line


def check_unreleased_placement(doc: Doc, s: Settings, report: Report) -> None:
    phrase = s.unreleased_phrase
    if not phrase:
        return
    blockquote = f"> {phrase}。"
    heading_idx = {h.line - 1 for h in doc.headings if h.level in (2, 3)}
    for i, line in enumerate(doc.lines):
        if doc.in_fence[i] or line.strip() != blockquote:
            continue
        placed = i >= 2 and not doc.lines[i - 1].strip() and (i - 2) in heading_idx
        if not placed:
            report.add("p7a", doc.rel, i + 1, "(a) 型字樣沒有緊接在 H2／H3 之後（標題、一個空行、該行）")


def is_internal_doc_link(target: str, s: Settings) -> bool:
    t = target.strip("<>")
    if s.doc_host_re is not None and s.doc_host_re.search(t):
        return True
    if "://" in t or t.startswith(("#", "mailto:")):
        return False
    return t.split("#", 1)[0].split("?", 1)[0].lower().endswith(".md")


def check_guide_steps(doc: Doc, s: Settings, report: Report) -> None:
    if doc.doc_type != GUIDE_TYPE:
        return
    h2s = [h for h in doc.headings if h.level == 2]
    for idx, h in enumerate(h2s):
        if GUIDE_EXEMPT_H2_RE.search(h.text):
            continue
        end = h2s[idx + 1].line - 1 if idx + 1 < len(h2s) else len(doc.lines)
        for i in range(h.line, end):
            if doc.in_fence[i]:
                continue
            line = doc.lines[i]
            if GUIDE_PHRASE_RE.search(line):
                report.add("p5", doc.rel, i + 1, show(line))
            for _text, target in doc.links(i):
                if is_internal_doc_link(target, s):
                    report.add("p5", doc.rel, i + 1, "步驟區內有指向別份文件的連結：" + target)


class LinkChecker:
    def __init__(self, repo: Path) -> None:
        self.repo = repo
        self._anchors: Dict[Path, frozenset] = {}

    def anchors_of(self, path: Path, doc: Optional[Doc] = None) -> frozenset:
        if path not in self._anchors:
            parsed = doc if doc is not None else read_doc(path, path.name)
            self._anchors[path] = parsed.anchors() if parsed is not None else frozenset()
        return self._anchors[path]

    def problem(self, doc: Doc, doc_path: Path, target: str) -> Optional[str]:
        t = target.strip("<>")
        if "://" in t or t.startswith(("mailto:", "tel:", "data:")):
            return None
        raw_path, _, raw_anchor = t.partition("#")
        raw_path = unquote(raw_path.split("?", 1)[0])
        anchor = unquote(raw_anchor).lower()
        if raw_path:
            base = self.repo if raw_path.startswith("/") else doc_path.parent
            dest = Path(os.path.normpath(str(base / raw_path.lstrip("/"))))
            if not dest.exists():
                return "目標檔案不存在：" + raw_path
        else:
            dest = doc_path
        if anchor and dest.is_file() and dest.suffix.lower() == ".md":
            known = self.anchors_of(dest, doc if dest == doc_path else None)
            if anchor not in known:
                return "目標沒有對應標題的 anchor：#" + raw_anchor
        return None


def check_links(doc: Doc, doc_path: Path, checker: LinkChecker, report: Report) -> None:
    for i, _line in enumerate(doc.lines):
        if doc.in_fence[i]:
            continue
        for _text, target in doc.links(i):
            message = checker.problem(doc, doc_path, target)
            if message:
                report.add("p9c", doc.rel, i + 1, f"[{target}] {message}")


def check_copy_header(doc: Doc, s: Settings, report: Report) -> None:
    start = 0
    if not s.headerless:
        h1 = next((h for h in doc.headings if h.level == 1), None)
        if h1 is None:
            return
        start = h1.line
    for i in range(start, len(doc.lines)):
        line = doc.lines[i]
        if not line.strip():
            continue
        if line.startswith(COPY_PREFIX) and not COPY_LINE_RE.match(line.rstrip()):
            report.add("p11", doc.rel, i + 1, show(line))
        return


def check_lists(doc: Doc, report: Report, template: bool) -> None:
    """Report lists that have exactly one item (nested items and loose lists count as one list).

    PR／issue 範本（template=True）內只有一項的勾選清單（`- [ ]`）放行。
    """
    lines = doc.lines
    n = len(lines)
    count = 0
    first = -1
    kind = ""
    i = 0

    def close() -> None:
        nonlocal count, first, kind
        if count == 1 and not (template and CHECKBOX_ITEM_RE.match(lines[first])):
            report.add("p12", doc.rel, first + 1, show(lines[first]))
        count, first, kind = 0, -1, ""

    while i < n:
        line = lines[i]
        if doc.in_fence[i]:
            j = i
            while j + 1 < n and doc.in_fence[j + 1] and (j + 1) not in doc.fence_indent:
                j += 1
            if not (count and doc.fence_indent.get(i, 0) > 0):
                close()  # an indented code block stays inside the open list item
            i = j + 1
            continue
        if not line.strip():
            pass  # a blank line only ends the list if the next non-blank line is neither item nor indented
        elif THEMATIC_BREAK_RE.match(line):
            close()  # `* * *` is a thematic break, not a list
        elif LIST_RE.match(line):
            marker = LIST_RE.match(line).group(1)
            this_kind = "ordered" if marker[0].isdigit() else "bullet"
            if count and line[0] not in " \t" and this_kind != kind:
                close()  # a top-level change of list type starts a new list (CommonMark)
            if not count:
                first, kind = i, this_kind
            count += 1
        elif not (count and line[0] in " \t"):
            close()
        i += 1
    close()


def sentences_of(text: str) -> List[str]:
    return [p.strip() for p in re.split(r"[。！？]", text) if p.strip()]


def visible_length(text: str) -> int:
    return len(re.sub(r"\]\([^)]*\)", "]", text))


def check_readability_hints(doc: Doc, report: Report) -> None:
    lines = doc.lines
    paragraph: List[Tuple[int, str]] = []

    def flush() -> None:
        if not paragraph:
            return
        first = paragraph[0][0] + 1
        text = " ".join(l.strip() for _, l in paragraph)
        sents = sentences_of(text)
        chars = visible_length(text)
        if len(sents) > P6_MAX_PARAGRAPH_SENTENCES or chars > P6_MAX_PARAGRAPH_CHARS:
            report.add("p6", doc.rel, first, f"段落 {len(sents)} 句／{chars} 字（參考上限 5 句／220 字）：{show(text)[:60]}…")
        for sent in sents:
            if visible_length(sent) > P6_MAX_SENTENCE_CHARS:
                report.add("p6", doc.rel, first, f"單句 {visible_length(sent)} 字（參考上限 80 字）：{sent[:60]}…")
        paragraph.clear()

    for i, line in enumerate(lines):
        stripped = line.strip()
        if doc.in_fence[i]:
            flush()
            continue
        if stripped.startswith("|"):
            flush()
            for cell in table_cells(stripped):
                if visible_length(cell) > P6_MAX_CELL_CHARS:
                    report.add("p6", doc.rel, i + 1, f"表格格 {visible_length(cell)} 字（參考上限 60 字）：{cell[:60]}…")
            continue
        is_text = (
            bool(stripped)
            and not HEADING_RE.match(line)
            and not LIST_RE.match(line)
            and not stripped.startswith((">", "<!--"))
            and line[0] not in " \t"
        )
        if is_text:
            paragraph.append((i, line))
        else:
            flush()
    flush()


def table_cells(row: str) -> List[str]:
    cells = [c.strip() for c in row.replace("\\|", "\0").strip("|").split("|")]
    cells = [c.replace("\0", "|") for c in cells]
    if cells and all(TABLE_SEP_CELL_RE.match(c) for c in cells if c):
        return []
    return cells


HEADING_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$")
TITLE_IN_REF_RE = re.compile(r"〈([^〉]+)〉")
SECTION_ENUM_RE = re.compile(r"[、，]\s*(\d+(?:\.\d+)*)(?![\d.])")
# A dotted number (3.6, 3.10.1) is always a section number; a single number ("設計文件 2 份") only when
# it is followed by 節／章、a quote or bracket, or punctuation, or ends the line.
SECTION_TAIL_RE = re.compile(r"\s*(?:$|[節章「〈、，）。；:：])")


def normalize_title(text: str) -> str:
    text = re.sub(r"\s+#+\s*$", "", text.replace("`", ""))
    return re.sub(r"\s+", " ", text).strip()


def before_paren(title: str) -> str:
    """The part of a title before its first full-width 「（」: the parenthesised suffix is an aside, and may be left out."""
    return title.split("（", 1)[0].strip()


class HeadingRefChecker:
    """p9d for one HEADING_REF document: its current titles, bare titles (no number) and section numbers.

    Every title is also known without its 「（…）」 suffix, with and without the leading number.
    """

    def __init__(self, ref: HeadingRef, doc: Doc) -> None:
        self.ref = ref
        self.titles: set = set()
        self.bare_titles: set = set()
        self.numbers: set = set()
        for h in doc.headings:
            title = normalize_title(h.text)
            for variant in (title, before_paren(title)):
                if not variant:
                    continue
                self.titles.add(variant)
                numbered = HEADING_NUMBER_RE.match(variant)
                if numbered:
                    self.numbers.add(numbered.group(1))
                    bare = numbered.group(2).strip()
                    self.bare_titles.update(t for t in (bare, before_paren(bare)) if t)

    def known_title(self, title: str) -> bool:
        return title in self.titles or title in self.bare_titles or title in self.numbers

    def check_line(self, rel: str, n: int, line: str, report: Report) -> None:
        code_spans: Optional[List[Tuple[int, int]]] = None

        def in_code(start: int, end: int) -> bool:
            # A reference inside inline code is an example, not a reference (same as p9c).  Only the
            # reference itself has to sit inside: a file name in backticks followed by 〈…〉 is checked.
            nonlocal code_spans
            if code_spans is None:
                code_spans = [m.span() for m in CODE_SPAN_RE.finditer(line)]
            return any(s <= start and end <= e for s, e in code_spans)

        for m in self.ref.title_re.finditer(line):
            base = m.start("refs")
            for tm in TITLE_IN_REF_RE.finditer(m.group("refs")):
                title = normalize_title(tm.group(1))
                if not self.known_title(title) and not in_code(base + tm.start(), base + tm.end()):
                    report.add("p9d", rel, n, f"〈{title}〉（{self.ref.path} 沒有這個標題）")
        if not self.numbers:
            return
        for m in self.ref.number_re.finditer(line):
            found = [(m.group("num"),) + m.span("num")]
            pos = m.end()
            while True:
                more = SECTION_ENUM_RE.match(line, pos)
                if not more:
                    break
                found.append((more.group(1),) + more.span(1))
                pos = more.end()
            for number, start, end in found:
                if "." not in number and not SECTION_TAIL_RE.match(line, end):
                    continue
                if number not in self.numbers and not in_code(start, end):
                    report.add("p9d", rel, n, f"節號 {number}（{self.ref.path} 沒有這個節號）")


def load_heading_checkers(repo: Path, s: Settings) -> List[HeadingRefChecker]:
    checkers = []
    for ref in s.heading_refs:
        path = repo / ref.path
        doc = read_doc(path, ref.path) if path.is_file() else None
        if doc is None:
            raise FileNotFoundError(f"HEADING_REF 的文件不存在或讀不到：{ref.path}")
        checkers.append(HeadingRefChecker(ref, doc))
    return checkers


def check_heading_refs(rel: str, path: Path, checkers: List[HeadingRefChecker], report: Report) -> None:
    """Scan one file of any type for 〈標題〉／節號 references; binary or unreadable files are skipped."""
    try:
        data = path.read_bytes()
    except OSError:
        return
    if b"\0" in data:
        return
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return
    for i, raw in enumerate(text.split("\n")):
        line = raw.rstrip("\r")
        for checker in checkers:
            checker.check_line(rel, i + 1, line, report)


def scan_doc(doc: Doc, doc_path: Path, s: Settings, checker: LinkChecker, report: Report) -> None:
    exempt = any(fnmatch.fnmatchcase(doc.rel, pattern) for pattern in s.no_header)
    check_header(doc, s, report, exempt)
    check_heading_vs_type(doc, report)
    check_line_patterns(doc, s, report)
    check_unreleased_placement(doc, s, report)
    check_guide_steps(doc, s, report)
    check_links(doc, doc_path, checker, report)
    check_copy_header(doc, s, report)
    check_lists(doc, report, bool(TEMPLATE_PATH_RE.search(doc.rel)))
    check_readability_hints(doc, report)


# ---------------------------------------------------------------- output


def render(report: Report, scanned: int, repo: Path, s: Settings) -> Tuple[str, bool]:
    out: List[str] = []
    extra = " ".join(s.excludes) if s.excludes else "無"
    out.append(f"掃描檔：{scanned} 個（repo={repo}；預設排除：changelog、docs/adr/；--exclude／EXCLUDE：{extra}）")
    overrides = "、".join(s.overrides) if s.overrides else "無"
    refs = "、".join(sorted({r.path for r in s.heading_refs})) or "未設定"
    out.append(f"設定檔：{s.config_path or '無'}；詞表覆寫：{overrides}；標題引用：{refs}")
    for key in HARD_IDS:
        if key in LIST_ONLY_IDS or not report.hits[key]:
            continue
        out.append(f"== {TITLES[key]}")
        for rel, line, text in report.hits[key]:
            out.append(f"{rel}:{line}: {text}")
    if report.hits["p3-allow"]:
        out.append("== p3-allow：行內 allow marker 使用清單（不計 FAIL；交付時逐檔給 verifier 看）")
        per_file: Dict[str, int] = {}
        for rel, line, text in report.hits["p3-allow"]:
            per_file[rel] = per_file.get(rel, 0) + 1
            out.append(f"{rel}:{line}: {text}")
        for rel, number in per_file.items():
            out.append(f"逐檔：{rel} = {number}")
    if report.hits["p7-section"]:
        out.append("== p7-section：以區段名指稱未發版區段的行（不計 FAIL；verifier 核對是流程句，不是某個行為只在主幹）")
        for rel, line, text in report.hits["p7-section"]:
            out.append(f"{rel}:{line}: {text}")
    if report.hits["p8-source"]:
        out.append("== p8-source：帶出處標示但無證據等級的行（不計 FAIL；verifier 核對是結構事實，不是行為結果）")
        for rel, line, text in report.hits["p8-source"]:
            out.append(f"{rel}:{line}: {text}")
    if report.hits["p4h"] or report.hits["p6"]:
        out.append("== 提示（不計入 FAIL）")
        for key, label in (("p4h", "p4h 7–40 位 hex 字串（只能是版本號、雜湊值範例或程式碼範例）"), ("p6", "p6 超過參考上限的位置")):
            if report.hits[key]:
                out.append(f"-- {label}")
                for rel, line, text in report.hits[key]:
                    out.append(f"{rel}:{line}: {text}")
    hard = " ".join(f"{k}={report.count(k)}" for k in HARD_IDS)
    hints = " ".join(f"{k}={report.count(k)}" for k in HINT_IDS)
    failed = any(report.count(k) for k in HARD_IDS if k not in LIST_ONLY_IDS)
    out.append(f"SUMMARY {hard} | hints {hints}")
    out.append("RESULT FAIL" if failed else "RESULT PASS")
    return "\n".join(out) + "\n", failed


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="check_docs.py",
        description="writing-principles 的機械檢查：掃一個 repo 的 Markdown，逐原則列出命中。",
    )
    p.add_argument("files", nargs="*", metavar="FILE", help="只掃這些檔（不套預設排除）；省略則掃預設範圍")
    p.add_argument("--repo", default=".", help="目標 repo 目錄（預設 cwd）")
    p.add_argument("--config", help="設定檔路徑（預設 <repo>/.writing-principles.conf，不存在就略過）")
    p.add_argument("--exclude", action="append", metavar="GLOB", help="額外排除的路徑 glob（對相對路徑 fnmatch），可重複；每個都要在 PR 說明")
    p.add_argument("--ticket-re", help="票號 regex（覆寫設定 TICKET_RE）")
    p.add_argument("--unreleased-phrase", help="未發版固定字樣（覆寫設定 UNRELEASED_PHRASE）")
    p.add_argument("--types", help="額外文件型別，以 | 分隔（與設定 TYPES 合併）")
    p.add_argument("--no-header", action="append", metavar="PATHS", help="免檔頭的路徑，空白分隔，可重複（與設定 NO_HEADER 合併）")
    p.add_argument("--headerless", action="store_true", help="wiki 讀回檔：沒有 # 標題，檔頭取檔案最前兩個非空行")
    p.add_argument("--doc-host-re", help="視為『別份文件』的 wiki 網域 regex（覆寫設定 DOC_HOST_RE）")
    p.add_argument(
        "--heading-ref",
        action="append",
        metavar="\"PATH [RE]\"",
        help="啟用 p9d：<文件路徑> [前綴 regex]，前綴省略時用檔名；可重複（與設定 HEADING_REF 合併）",
    )
    p.add_argument("--list", action="store_true", help="只印掃描範圍內的檔案後結束")
    return p


def main(argv: List[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    repo = Path(args.repo).resolve()
    if not repo.is_dir():
        print(f"錯誤：--repo 不是目錄：{args.repo}", file=sys.stderr)
        return 2
    try:
        config_path = Path(args.config) if args.config else repo / ".writing-principles.conf"
        if args.config and not config_path.is_file():
            raise FileNotFoundError(f"找不到設定檔：{args.config}")
        config = load_config(config_path) if config_path.is_file() else {}
        settings = build_settings(config, args)
        settings.config_path = str(config_path) if config_path.is_file() else ""
        if args.files:
            targets = resolve_explicit(repo, args.files)
        else:
            names = apply_excludes(default_scope(repo), settings.excludes)
            targets = [(n, repo / n) for n in names]
    except (ValueError, FileNotFoundError) as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 2
    if not targets:
        print("錯誤：掃描範圍內沒有任何 Markdown 檔（檢查 --repo、--exclude 與 EXCLUDE）", file=sys.stderr)
        return 2
    if args.list:
        for rel, _path in targets:
            print(rel)
        return 0
    try:
        heading_checkers = load_heading_checkers(repo, settings)
    except FileNotFoundError as exc:
        print(f"錯誤：{exc}", file=sys.stderr)
        return 2
    report = Report()
    checker = LinkChecker(repo)
    for rel, path in targets:
        doc = read_doc(path, rel)
        if doc is None:
            print(f"錯誤：讀不到檔案：{path}", file=sys.stderr)
            return 2
        scan_doc(doc, path, settings, checker, report)
    if heading_checkers:
        # p9d reads every tracked file (code comments, test names, config), not only the Markdown scope.
        p9d_targets = targets if args.files else [
            (n, repo / n) for n in apply_excludes(p9d_default_scope(repo), settings.excludes)
        ]
        for rel, path in p9d_targets:
            check_heading_refs(rel, path, heading_checkers, report)
    text, failed = render(report, len(targets), repo, settings)
    sys.stdout.write(text)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
