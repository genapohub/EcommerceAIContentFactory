#!/usr/bin/env python3
"""Harness 最小 evals runner · v0.4

对应 regression-cases.json 中声明的 14 个 case（全部落地为静态/结构检查）:

  Harness 治理
    harness-001  Harness 治理三件套已落位（AGENTS.md / project-tracker.md / SECURITY.md）
  代码质量
    code-001    命名规范（Python 应为 snake_case；代码文件名不含空格）
    code-002    无遗留调试代码（console.log / debugger / print( / breakpoint）
    code-003    测试覆盖率（结构代理：检测测试基础设施是否就位；逐文件 0.8 覆盖率需 CI --cov）
  规范遵守
    spec-001    不调用黑名单工具（rm -rf /、git push --force、擅改 CI workflow）
    spec-002    PR 描述完整性（本地仅查 PR 模板存在性；逐字段校验需 CI/forge 集成）
    spec-003    commit message 规范（conventional commits 前缀 + 首行长度）
  文档质量
    doc-001     PRD 结构完整性（背景/用户画像/用户故事/功能需求/非功能/成功指标/优先级）
    doc-002     API 文档完整性（端点/方法/请求参数/响应/错误码/示例/鉴权）
    doc-003     技术选型/设计文档决策可追溯（方案/对比/推荐/理由/拒绝备选）
  AI 协作
    collab-001  跨角色上下文交接（project-tracker.md 含「AI 协作上下文」段）
    collab-002  角色冲突升级路径（project-tracker.md 含「决策日志」段）
  安全合规
    security-001 无密钥泄露（硬编码密钥模式 + .env 被 git 跟踪）
    security-002 敏感数据脱敏（客户数据文件中无明文手机号/身份证号）

v0.4 变更（P0 修复：此前仅实现 4/14，名不副实）:
  - 新增 10 个 case 的静态/结构实现：code-001 / code-003 / spec-001 / spec-002 /
    doc-001 / doc-002 / doc-003 / collab-001 / collab-002 / security-002
  - 新增 doc 专用 walker（独立于 SKIP_DIRS，覆盖真实项目的「数字编号目录」如 01-产品文档）
  - 新增 project-tracker 柔性定位（根目录 / docs/ / .ai/ 等常见位置）
  - code-003 / spec-002 为「代理检查」：本地静态只能验证前置条件，逐文件覆盖率与
    PR 字段完整性依赖 CI + forge API，runner 仅输出提示性命中

v0.3 变更:
  - 增加 harness-001: 检查项目根目录 AGENTS.md / project-tracker.md / SECURITY.md 是否存在

v0.2 变更（来自真实项目首扫实战反馈）:
  - code-002 豁免 test_*.py / deploy/ / migrate_* / scripts/ —— 测试与 CLI 脚本的
    print 输出是设计意图，不是遗留调试代码
  - security-001 修两类假阳性: .env.example 属合法跟踪文件；密钥正则收紧为赋值形式
    （不再跨行、不再误报 os.getenv 读取模式）
  - spec-003 支持 --since 增量模式（历史存量 commit 不改写，用增量守护新增）

v0.1 边界仍适用:
  - 全量扫描存量代码会产生噪音，首个结果作为「质量基线」
  - 历史全量密钥审计交给 gitleaks 等专业工具
  - doc/spec/collab 的部分 case 为「结构/代理检查」，命中=待人工复核项，不一定是硬伤
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Optional

RUNNER_VERSION = "0.4"


def configure_output_encoding():
    """Keep Windows consoles from failing on Chinese text and status icons."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def write_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")

CODE_EXTS = {".py", ".js", ".ts", ".vue", ".wxml", ".json"}
SKIP_DIRS = {".git", ".ai", ".claude", ".cursor", ".github", ".kiro",
             "skills", "evals", "docs", "node_modules", "dist", "build",
             "__pycache__", ".miniprogram_npm", "venv", ".venv", "logs", "data"}
COMMIT_SAMPLE = 10

# code-002 豁免清单: 路径/文件名以此为前缀的文件不参与调试残留检查
DEBUG_EXEMPT = ("test_", "deploy/", "migrate_", "scripts/")

# code-002 调试残留模式（按语言分组）
DEBUG_PATTERNS = {
    ".py": [r"\bprint\(", r"\bbreakpoint\(", r"pdb\.set_trace\("],
    ".js": [r"console\.log\(", r"\bdebugger\b"],
    ".ts": [r"console\.log\(", r"\bdebugger\b"],
    ".vue": [r"console\.log\(", r"\bdebugger\b"],
    ".wxml": [],
    ".json": [],
}

# security-001 硬编码密钥模式（name, regex）
SECRET_PATTERNS = [
    ("wechat_appsecret", r"[Aa]pp[Ss]ecret\W{0,5}([a-f0-9]{32})"),
    ("openai_key", r"sk-[A-Za-z0-9_\-]{20,}"),
    ("aws_access_key", r"AKIA[0-9A-Z]{16}"),
    ("github_token", r"ghp_[A-Za-z0-9]{30,}"),
    ("generic_password", r"""(?i)\b(password|passwd|pwd)\s*=\s*['"][^'"\n]{4,}['"]"""),
    ("generic_api_key", r"""(?i)\b(api[_-]?key|secret[_-]?key)\s*=\s*['"][A-Za-z0-9_\-]{16,}['"]"""),
]

CONVENTIONAL_RE = re.compile(
    r"^(feat|fix|refactor|docs|test|chore|style|perf|build|ci)(\([^)]*\))?: \S")

# ---------------------------------------------------------------------------
# spec-001 黑名单工具
# ---------------------------------------------------------------------------
BLACKLIST_PATTERNS = [
    ("rm_rf_absolute", re.compile(r"rm\s+-rf\s+/(?!\*)")),          # 删根，不可逆
    ("git_force_push", re.compile(r"git\s+push\s+(--force|-f)\b")),  # 强推，丢历史
    ("fork_bomb", re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}")),  # 叉子炸弹
]
CI_WORKFLOWS = ".github/workflows"

# ---------------------------------------------------------------------------
# security-002 敏感数据脱敏（仅扫数据导出类文件，控制噪音）
# ---------------------------------------------------------------------------
CN_MOBILE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
CN_ID_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
PII_DATA_EXTS = {".csv", ".tsv", ".txt"}

# ---------------------------------------------------------------------------
# doc-* 文档结构检查
# ---------------------------------------------------------------------------
GOV_MD = {"AGENTS.md", "SECURITY.md", "README.md", "CHANGELOG.md",
          "project-tracker.md", "CODE_OF_CONDUCT.md", "LICENSE.md",
          "CONTRIBUTING.md", "CODEOWNERS"}

PRD_SECTIONS = {
    "背景": ["背景", "项目背景", "概述", "简介", "导语"],
    "用户画像": ["用户画像", "用户角色", "目标用户", "persona", "用户群体", "用户分析"],
    "用户故事": ["用户故事", "user story", "场景", "用例", "use case"],
    "功能需求": ["功能需求", "功能列表", "需求说明", "功能模块", "需求"],
    "非功能需求": ["非功能", "性能需求", "可用性", "安全需求", "质量属性"],
    "成功指标": ["成功指标", "成功标准", "衡量", "metrics", "北极星", "kpi", "验收标准"],
    "优先级": ["优先级", "p0", "p1", "p2", "重要紧急"],
}
API_SECTIONS = {
    "端点": ["端点", "endpoint", "接口", "api"],
    "方法": ["请求方法", "method", "http 方法", "请求方式"],
    "请求参数": ["请求参数", "request", "入参", "参数说明", "请求字段"],
    "响应": ["响应", "response", "返回", "出参", "响应格式"],
    "错误码": ["错误码", "error code", "状态码", "异常", "错误"],
    "示例": ["示例", "example", "请求示例", "响应示例", "样例"],
    "鉴权": ["鉴权", "认证", "auth", "权限", "token"],
}
DESIGN_SECTIONS = {
    "方案选项": ["方案", "选项", "选型", "候选", "对比方案", "备选"],
    "对比": ["对比", "比较", "comparison", "矩阵", "matrix", "优劣", "权衡"],
    "推荐": ["推荐", "结论", "建议方案", "选型结论", "最终选择", "决定"],
    "理由": ["理由", "原因", "rationale", "why", "取舍", "依据"],
    "拒绝备选": ["拒绝", "不采用", "已否决", "弃用", "why not"],
}

# project-tracker.md 柔性候选位置
TRACKER_CANDIDATES = [
    "project-tracker.md",
    "docs/project-tracker.md",
    ".ai/project-tracker.md",
]


# ---------------------------------------------------------------------------
# 共享工具
# ---------------------------------------------------------------------------
def git(repo: Path, *args) -> str:
    out = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else ""


def list_code_files(repo: Path):
    for p in sorted(repo.rglob("*")):
        if not p.is_file() or p.suffix not in CODE_EXTS:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        yield p


def walk_md(repo: Path):
    """doc-* 专用：扫描 markdown，跳过治理/元文件与 harness 元文档。"""
    for p in sorted(repo.rglob("*.md")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.name in GOV_MD:
            continue
        if "harness" in str(p).lower():  # 跳过 kit 自身 docs/harness 等元文档
            continue
        yield p


def find_project_tracker(repo: Path) -> Optional[Path]:
    for cand in TRACKER_CANDIDATES:
        fp = repo / cand
        if fp.is_file():
            return fp
    for p in repo.rglob("project-tracker.md"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        return p
    return None


def headings(text: str):
    return [ln.strip() for ln in text.splitlines() if re.match(r"^#{1,6}\s", ln)]


def missing_sections(text: str, groups: dict) -> list:
    hs = " ".join(headings(text)).lower()
    return [label for label, kws in groups.items() if not any(kw in hs for kw in kws)]


# ---------------------------------------------------------------------------
# case 实现
# ---------------------------------------------------------------------------
def scan_harness_files(repo: Path):
    """harness-001: 项目根目录治理三件套必须落位。"""
    required = ["AGENTS.md", "project-tracker.md", "SECURITY.md"]
    return [
        {"file": name, "line": 0, "type": "missing_file", "match": "Harness 治理文件缺失"}
        for name in required
        if not (repo / name).is_file()
    ]


def scan_naming(repo: Path):
    """code-001: 命名规范（Python 应为 snake_case；代码文件名不含空格）。"""
    hits = []
    for p in list_code_files(repo):
        stem = p.stem
        if " " in stem:
            hits.append({"file": str(p.relative_to(repo)), "line": 0,
                         "type": "space_in_filename", "match": "文件名含空格"})
            continue
        if p.suffix == ".py" and not stem.islower() and not stem.isupper():
            hits.append({"file": str(p.relative_to(repo)), "line": 0,
                         "type": "py_not_snake", "match": "Python 文件名应为 snake_case"})
    return hits


def scan_debug(repo: Path):
    """code-002: 应用代码中的遗留调试代码（测试脚本/CLI 工具/迁移脚本豁免）

    豁免判定为「路径感知」：deploy/ scripts/ 目录（任意层级）、test_ / migrate_ 前缀文件
    （任意位置）均不参与检查——测试与 CLI 脚本的 print 输出是设计意图，不是遗留调试代码。
    """
    hits = []
    for p in list_code_files(repo):
        parts = p.parts
        if "deploy" in parts or "scripts" in parts:
            continue
        if p.name.startswith(("test_", "migrate_")):
            continue
        if "测试" in p.stem or p.stem.endswith((".test", ".spec")):
            continue
        pats = DEBUG_PATTERNS.get(p.suffix, [])
        if not pats:
            continue
        rel = str(p.relative_to(repo))
        try:
            for i, line in enumerate(read_text(p).splitlines(), 1):
                for pat in pats:
                    if re.search(pat, line):
                        hits.append({"file": rel, "line": i,
                                     "match": line.strip()[:80]})
                        break
        except OSError:
            continue
    return hits


def scan_test_coverage(repo: Path):
    """code-003: 测试覆盖率（结构代理）。

    本地静态无法测量逐文件 0.8 覆盖率，只能验证「测试基础设施是否就位」——
    没有 pytest/jest/tests 目录，新功能测试覆盖率就无从守护。
    """
    hits = []
    has_infra = False
    for p in repo.rglob("*"):
        if not p.is_file():
            continue
        name = p.name.lower()
        if name in {"pytest.ini", "setup.cfg", "jest.config.js", "jest.config.ts"}:
            has_infra = True
        elif name == "pyproject.toml" and "[tool.pytest" in read_text(p).lower():
            has_infra = True
        elif name == "package.json":
            txt = read_text(p).lower()
            if '"test"' in txt or "jest" in txt or "vitest" in txt:
                has_infra = True
    for d in repo.rglob("tests"):
        if d.is_dir():
            has_infra = True
    for d in repo.rglob("__tests__"):
        if d.is_dir():
            has_infra = True
    if not has_infra:
        hits.append({"file": repo.name, "line": 0, "type": "no_test_infra",
                     "match": "未发现测试基础设施（pytest/jest/tests）——无法守护新功能测试覆盖率（逐文件 0.8 需 CI --cov）"})
    return hits


def scan_blacklist_tools(repo: Path):
    """spec-001: 不调用黑名单工具（rm -rf /、git push --force、擅改 CI workflow）。"""
    hits = []
    for p in repo.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in {".sh", ".bash"} and p.name != "Makefile":
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        try:
            text = read_text(p)
        except OSError:
            continue
        rel = str(p.relative_to(repo))
        for name, pat in BLACKLIST_PATTERNS:
            for m in pat.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                hits.append({"file": rel, "line": line_no, "type": name, "match": m.group(0)[:60]})
    # git 历史：最近 N commit 是否改了 CI workflow
    log = git(repo, "log", f"-{COMMIT_SAMPLE}", "--name-only", "--pretty=%H").splitlines()
    for line in log:
        if CI_WORKFLOWS in line:
            hits.append({"file": line.strip(), "line": 0, "type": "ci_workflow_modified",
                         "match": "检测到 .github/workflows 变更（需人类 review，AI 不应擅改 CI）"})
    return hits


def scan_pr_template(repo: Path):
    """spec-002: PR 描述完整性（本地代理）。

    逐字段校验（类型前缀/变更原因/内容/验证/风险）需 CI + forge API 拉 PR body，
    本地只能验证「PR 模板是否就位」这一前置条件。
    """
    hits = []
    found = any((repo / c).is_file() for c in
                ["PULL_REQUEST_TEMPLATE.md", ".github/pull_request_template.md",
                 "docs/PULL_REQUEST_TEMPLATE.md"])
    if not found:
        for p in repo.rglob("*.md"):
            if "pull_request_template" in p.name.lower() or "merge_request_template" in p.name.lower():
                found = True
                break
    if not found:
        hits.append({"file": repo.name, "line": 0, "type": "no_pr_template",
                     "match": "未找到 PR 模板——PR 描述完整性需 CI/forge 集成守护（本地仅查模板存在性）"})
    return hits


def scan_commits(repo: Path, since: Optional[str] = None):
    """spec-003: commit message 规范（默认最近 N 条；--since 后只查 <since>..HEAD）"""
    rng = [f"{since}..HEAD"] if since else [f"-{COMMIT_SAMPLE}"]
    hits = []
    log = git(repo, "log", *rng, "--pretty=%h %s").strip()
    for line in log.splitlines():
        if not line:
            continue
        sha, subject = line.split(" ", 1)
        if not CONVENTIONAL_RE.match(subject):
            hits.append({"commit": sha, "issue": "缺 conventional 前缀", "subject": subject[:80]})
        elif len(subject) > 72:
            hits.append({"commit": sha, "issue": f"首行 {len(subject)} 字符 > 72", "subject": subject[:80]})
    return hits


def scan_prd_docs(repo: Path):
    """doc-001: PRD 结构完整性。"""
    hits = []
    for p in walk_md(repo):
        rel = str(p.relative_to(repo)).lower()
        if not ("prd" in rel or "需求文档" in rel or "产品需求" in rel):
            continue
        try:
            text = read_text(p)
        except OSError:
            continue
        for label in missing_sections(text, PRD_SECTIONS):
            hits.append({"file": str(p.relative_to(repo)), "line": 0,
                         "type": "missing_prd_section", "match": f"PRD 缺章节：{label}"})
    return hits


def scan_api_docs(repo: Path):
    """doc-002: API 文档完整性。"""
    hits = []
    for p in walk_md(repo):
        rel = str(p.relative_to(repo)).lower()
        if not ("api" in rel or "接口" in rel):
            continue
        try:
            text = read_text(p)
        except OSError:
            continue
        for label in missing_sections(text, API_SECTIONS):
            hits.append({"file": str(p.relative_to(repo)), "line": 0,
                         "type": "missing_api_section", "match": f"API 文档缺章节：{label}"})
    return hits


def scan_design_docs(repo: Path):
    """doc-003: 技术选型/设计文档决策可追溯。"""
    hits = []
    for p in walk_md(repo):
        rel = str(p.relative_to(repo)).lower()
        if not any(k in rel for k in ("选型", "adr", "技术方案", "架构决策", "技术设计")):
            continue
        try:
            text = read_text(p)
        except OSError:
            continue
        for label in missing_sections(text, DESIGN_SECTIONS):
            hits.append({"file": str(p.relative_to(repo)), "line": 0,
                         "type": "missing_design_section", "match": f"选型/设计文档缺章节：{label}"})
    return hits


def check_collab_handoff(repo: Path):
    """collab-001: 跨角色上下文交接（project-tracker.md 含「AI 协作上下文」段）。"""
    hits = []
    pt = find_project_tracker(repo)
    if not pt:
        hits.append({"file": "project-tracker.md", "line": 0,
                     "type": "missing_file", "match": "未找到 project-tracker.md（collab-001/002 共用）"})
        return hits
    text = read_text(pt)
    if "AI 协作上下文" not in text and "协作上下文" not in text:
        hits.append({"file": str(pt.relative_to(repo)), "line": 0,
                     "type": "missing_section", "match": "缺「AI 协作上下文」段"})
    return hits


def check_conflict_escalation(repo: Path):
    """collab-002: 角色冲突升级路径（project-tracker.md 含「决策日志」段）。"""
    hits = []
    pt = find_project_tracker(repo)
    if not pt:
        return hits  # 缺失已由 collab-001 报告
    text = read_text(pt)
    if "决策日志" not in text:
        hits.append({"file": str(pt.relative_to(repo)), "line": 0,
                     "type": "missing_section", "match": "缺「决策日志」段"})
    return hits


def scan_secrets(repo: Path):
    """security-001: 硬编码密钥 + .env 被 git 跟踪"""
    hits = []
    for p in list_code_files(repo):
        try:
            text = read_text(p)
        except OSError:
            continue
        for name, pat in SECRET_PATTERNS:
            for m in re.finditer(pat, text):
                line_no = text.count("\n", 0, m.start()) + 1
                line = text.splitlines()[line_no - 1]
                if "getenv" in line or "environ[" in line:
                    continue  # 从环境读取密钥的合法模式
                hits.append({"file": str(p.relative_to(repo)), "line": line_no,
                             "type": name, "match": m.group(0)[:60]})
    tracked = [f for f in git(repo, "ls-files").splitlines()
               if f == ".env" or (f.startswith(".env.") and "example" not in f)]
    for f in tracked:
        hits.append({"file": f, "line": 0, "type": "env_file_tracked",
                     "match": "密钥文件被 git 跟踪（应 gitignore + git rm --cached，若已进历史需轮换）"})
    return hits


def scan_sensitive_data(repo: Path):
    """security-002: 敏感数据脱敏（客户数据文件中无明文手机号/身份证号）。"""
    hits = []
    for p in repo.rglob("*"):
        if not p.is_file() or p.suffix not in PII_DATA_EXTS:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        try:
            text = read_text(p)
        except OSError:
            continue
        rel = str(p.relative_to(repo))
        for m in CN_MOBILE_RE.finditer(text):
            hits.append({"file": rel, "line": 0, "type": "cn_mobile", "match": m.group(0)})
        for m in CN_ID_RE.finditer(text):
            hits.append({"file": rel, "line": 0, "type": "cn_id_card", "match": m.group(0)})
    return hits


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    configure_output_encoding()

    ap = argparse.ArgumentParser()
    ap.add_argument("repo", help="目标 git 仓库路径")
    ap.add_argument("--json", dest="json_out", default=None, help="JSON 报告输出路径")
    ap.add_argument("--since", default=None,
                    help="spec-003 增量模式: 只检查 <since>..HEAD（如 HEAD~1）")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    if not repo.is_dir():
        sys.exit(f"[失败] 目录不存在: {repo}")

    cases = [
        {"id": "harness-001", "name": "Harness 治理三件套已落位", "hits": scan_harness_files(repo)},
        {"id": "code-001", "name": "命名规范", "hits": scan_naming(repo)},
        {"id": "code-002", "name": "无遗留调试代码", "hits": scan_debug(repo)},
        {"id": "code-003", "name": "测试覆盖率（结构代理）", "hits": scan_test_coverage(repo)},
        {"id": "spec-001", "name": "不调用黑名单工具", "hits": scan_blacklist_tools(repo)},
        {"id": "spec-002", "name": "PR 描述完整性（模板代理）", "hits": scan_pr_template(repo)},
        {"id": "spec-003", "name": "commit message 规范", "hits": scan_commits(repo, args.since)},
        {"id": "doc-001", "name": "PRD 结构完整性", "hits": scan_prd_docs(repo)},
        {"id": "doc-002", "name": "API 文档完整性", "hits": scan_api_docs(repo)},
        {"id": "doc-003", "name": "技术选型/设计文档决策可追溯", "hits": scan_design_docs(repo)},
        {"id": "collab-001", "name": "跨角色上下文交接", "hits": check_collab_handoff(repo)},
        {"id": "collab-002", "name": "角色冲突升级路径", "hits": check_conflict_escalation(repo)},
        {"id": "security-001", "name": "无密钥泄露", "hits": scan_secrets(repo)},
        {"id": "security-002", "name": "敏感数据脱敏", "hits": scan_sensitive_data(repo)},
    ]
    for c in cases:
        c["status"] = "pass" if not c["hits"] else "fail"

    report = {
        "repo": repo.name, "date": date.today().isoformat(),
        "runner": RUNNER_VERSION,
        "summary": {"pass": sum(1 for c in cases if c["status"] == "pass"),
                    "fail": sum(1 for c in cases if c["status"] == "fail")},
        "cases": cases,
    }

    print(f"\n=== evals 基线 · {repo.name} · runner v{RUNNER_VERSION} · {len(cases)} cases ===")
    for c in cases:
        mark = "[通过]" if c["status"] == "pass" else "[失败]"
        print(f"{mark} {c['id']} {c['name']}: {len(c['hits'])} 处命中")
        for h in c["hits"][:10]:
            loc = h.get("file", h.get("commit", "?"))
            line = f":{h['line']}" if h.get("line") else ""
            detail = h.get("match") or h.get("subject") or h.get("issue", "")
            print(f"     {loc}{line}  {h.get('type', h.get('issue', ''))}  {detail}")
        if len(c["hits"]) > 10:
            print(f"     … 其余 {len(c['hits']) - 10} 处见 JSON 报告")
    passed = report["summary"]["pass"]
    total = len(cases)
    print(f"--- 结果: {passed}/{total} pass" + ("（基线已建立，建议按告警清单整改后复跑）" if passed < total else "，全绿") + "\n")

    out = Path(args.json_out) if args.json_out else \
        Path(__file__).parent / "reports" / f"{date.today().isoformat()}-{repo.name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    write_text(out, json.dumps(report, ensure_ascii=False, indent=2))
    print(f"报告 报告: {out}")

    sys.exit(0 if report["summary"]["fail"] == 0 else 1)


if __name__ == "__main__":
    main()
