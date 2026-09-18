# ai-harness-kit · AI 编程 Harness 项目根模板

> 后续主线维护仓库：`ai-harness-kit`。
> 目标是一件事：把 AI 编程治理层直接放进项目根目录，让 Claude Code / Cursor / GitHub Copilot / Kiro / Codex 在同一套规则下协作。
>
> English version → [README.en.md](README.en.md)

## 一、它解决什么问题

`ai-harness-kit` 不是业务代码框架，而是一套项目根目录级 AI 编程治理模板。

它把 4 类资产一次性放进项目：

1. `AGENTS.md`：AI 行为宪法，约束角色、工作流、红线、review。
2. `project-tracker.md`：项目状态单一事实源，记录 WIP、风险、决策、交接。
3. `.ai/skills-manifest.json` + `.ai/SKILLS.md`：项目可用角色技能清单。
4. `evals/` + 多工具适配文件：用回归检查和工具规则守住产出质量。

## 二、怎么用：克隆到你的项目根目录

对外只有一条使用方式——**把本仓库克隆成你的项目根目录**。克隆下来即为可用形态，不需要执行任何装机脚本。

```bash
git clone https://github.com/genapohub/ai-harness-kit.git your-project
cd your-project
git remote rename origin ai-harness-kit-template
git remote add origin git@github.com:your-org/your-project.git
```

也可以从 GitHub 上点 `Use this template` 创建自己的项目仓库，效果等同（本质仍是克隆一份副本）。

已经配置 SSH 的话：

```bash
git clone git@github.com:genapohub/ai-harness-kit.git your-project
```

想固定版本而不是跟随最新改动（版本列表见 §九）：

```bash
git clone -b harness-v1.20 https://github.com/genapohub/ai-harness-kit.git your-project
```

### 克隆后第一步：拉取角色技能

初始克隆不包含 `skills/` 下的角色技能内容（仓库只保留 `.gitkeep` 占位）。

**任务对话中，如果 AI 发现 `skills/*/SKILL.md` 缺失，会主动提示你拉取技能**——这是 `AGENTS.md` 工作流第 1.1 步的强制要求。完整命令清单在 **`.ai/SKILLS.md`**，按需只拉本项目启用的那几个即可，例如：

```bash
git clone https://github.com/genapohub/product-plan-guide.git skills/product-plan-guide
git clone https://github.com/genapohub/frontend-dev-guide.git skills/frontend-dev-guide
```

14 个技能仓的完整清单见 §六。

### 克隆后第二步：改三个入口文件

改 `AGENTS.md` / `project-tracker.md` / `.ai/SKILLS.md` 三处即可开工，每个文件写什么见 §四。

### 例外：项目已存在

已经有自己的 `.git` 的存量项目，不要直接把本仓库 clone 进去（会打乱原有历史）。把下面这些资产复制到现有项目根目录：

```text
AGENTS.md
project-tracker.md
SECURITY.md
.ai/
.claude/
.cursor/
.github/
.kiro/
evals/
docs/          # 可选：Harness 方法论速览，不需要可略过
```

复制后改上面三个入口文件即可开工。以后要拉取角色技能，按 `.ai/SKILLS.md` 里的命令逐个 clone 即可。

## 三、项目结构

```text
your-project/
├── AGENTS.md                  # AI 行为宪法：项目身份、角色、红线、工作流
├── project-tracker.md         # 项目状态单一事实源：WIP、风险、决策、AI 交接
├── SECURITY.md                # 安全子法：密钥、脱敏、模型路由、事故响应
├── .ai/SKILLS.md              # 项目技能清单
├── .ai/skills-manifest.json   # 14 个角色技能仓库清单
├── .ai/harness.variables.example.json # 项目动态变量样例
├── .claude/settings.json      # Claude Code 权限建议
├── .cursor/rules/harness.mdc  # Cursor 项目规则
├── .github/                   # Copilot 指令 + PR 模板
├── .kiro/steering/harness.md  # Kiro steering
├── skills/                    # 初始为空，按需克隆 14 个独立角色技能仓库
├── evals/                     # AI 产出质量回归检查
└── docs/harness/              # Harness 方法论速览（可选），外部项目可删
```

> `docs/` 只是方法论参考，**不是运行必需的**，外部项目可以直接删掉。

## 四、开工前只需要改三处

1. `AGENTS.md`：项目目标、目标用户、技术栈、当前阶段。
2. `project-tracker.md`：当前阶段总览、WIP、风险、决策日志。
3. `.ai/SKILLS.md`：确认本项目启用哪些角色技能。

## 五、不同 AI 工具怎么读

| 能力 | 文件 |
|---|---|
| AI 行为规范 | `AGENTS.md` |
| 项目状态持久化 | `project-tracker.md` |
| 安全红线 | `SECURITY.md` |
| 角色技能清单 | `.ai/skills-manifest.json` + `.ai/SKILLS.md` |
| Claude Code 适配 | `.claude/settings.json` |
| Cursor 适配 | `.cursor/rules/harness.mdc` |
| GitHub Copilot 适配 | `.github/copilot-instructions.md` |
| PR 模板 | `.github/pull_request_template.md` |
| Kiro 适配 | `.kiro/steering/harness.md` |
| 质量回归检查 | `evals/runner.py` |
| 方法论参考（可选） | `docs/harness/` |

使用建议：

1. Claude Code / Codex：进入项目后先读 `AGENTS.md`、`project-tracker.md`、`.ai/SKILLS.md`。
2. Cursor：自动读取 `.cursor/rules/harness.mdc`，同时把 `AGENTS.md` 作为项目规则源。
3. GitHub Copilot：读取 `.github/copilot-instructions.md` 和 PR 模板。
4. Kiro：读取 `.kiro/steering/harness.md`。
5. 团队协作：每次重要变更都同步更新 `project-tracker.md`。

## 六、角色技能维护

`ai-harness-kit` 主仓库推送时过滤 `skills/` 内容，只保留 `skills/.gitkeep` 占位。14 个角色技能各自是独立 GitHub 仓库，完整清单与拉取命令见 `.ai/SKILLS.md`。

任务对话里，如果 AI 发现 `skills/` 为空或缺少 `SKILL.md`，**必须先提示你拉取技能**，再使用角色技能——这是 `AGENTS.md` 工作流第 1.1 步的强制要求。

维护规则：

1. 修改角色技能时，直接改那个技能仓库的工作副本。
2. 在对应技能目录里 commit 并 push 到 `https://github.com/genapohub/<skill-name>`。
3. `ai-harness-kit` 主仓库不提交 `skills/<skill-name>/` 内容，只提交清单与治理文件。
4. 新增或删除角色技能时，同步更新 `.ai/skills-manifest.json` 与 `.ai/SKILLS.md` 两张清单。

## 七、动态变量

模板里的项目字段统一使用 `{{VARIABLE_NAME}}` 占位，样例见 `.ai/harness.variables.example.json`。按项目实际情况把用到的 `{{...}}` 逐个替换即可，未替换的占位符不影响治理文件本身运转。

## 八、质量检查

日常使用不需要先跑脚本。需要验收 AI 产出时，可以运行：

```bash
python3 evals/runner.py . --since HEAD~1
```

检查范围（runner v0.4，对应 regression-cases.json 全部 14 个 case）：

- **Harness 治理**：harness-001 治理三件套（AGENTS.md / project-tracker.md / SECURITY.md）是否落位
- **代码质量**：code-001 命名规范（Python snake_case / 文件名无空格）· code-002 无遗留调试代码（console.log / debugger / print，deploy/scripts/test_/migrate_ 豁免）· code-003 测试覆盖率（结构代理：测试基础设施是否就位）
- **规范遵守**：spec-001 不调用黑名单工具（rm -rf /、git push --force、擅改 CI workflow）· spec-002 PR 描述完整性（本地仅查 PR 模板，逐字段需 CI/forge）· spec-003 commit message 规范（conventional 前缀 + 首行 ≤72）
- **文档质量**：doc-001 PRD 结构 · doc-002 API 文档结构 · doc-003 技术选型/设计文档决策可追溯
- **AI 协作**：collab-001 跨角色上下文交接（project-tracker 含「AI 协作上下文」）· collab-002 角色冲突升级（含「决策日志」）
- **安全合规**：security-001 无密钥泄露 · security-002 敏感数据脱敏（客户数据文件中无明文手机号/身份证号）

> 提示：doc / spec-002 / code-003 为「结构/代理检查」，命中=待人工复核的基线项，不一定是硬伤；历史存量告警按 regression-cases.json 豁免策略处理，增量模式（`--since`）守护新增。

### PR 门禁（evals-gate）

想要把质量检查变成合并前的硬约束，把仓库里的工作流模板启用到位：

```bash
cp .github/workflows/evals-gate.yml.example .github/workflows/evals-gate.yml
```

它在 PR 或 push 到 `main` 时自动执行 `python3 evals/runner.py . --since HEAD~1`。默认 `continue-on-error: true`（只收集基线、不挡合并）；观察几轮、确认误报都已豁免后，删掉那一行即变硬门禁。

## 九、版本

当前版本：`harness-v1.20`

v1.20 变更：

1. **移除全部 `scripts/` 维护脚本**（不再随仓库分发）：拉取角色技能改为在 `.ai/SKILLS.md` 中逐条 `git clone`，动态变量改为手动替换占位符。
2. **保留并强化「拉技能」提示机制**：`AGENTS.md` 工作流第 1.1 步要求 AI 发现 `skills/*/SKILL.md` 缺失时必须先提示人类并给出拉取命令；README §二、§六 同步说明。
3. PR 门禁模板移出 `scripts/`，改放 `.github/workflows/evals-gate.yml.example`，复制改名即启用。

v1.19 变更：

1. **移除装机脚本** `scripts/init-harness.py`：kit 不再携带任何「铺壳 / 注入」脚本，对外统一为克隆到项目根目录。
2. §二「例外：项目已存在」改为手动复制资产清单；PR 门禁改为从 `scripts/templates/evals-gate.yml` 复制到项目。

v1.18 变更：

1. **对外使用方式收敛为单一路径**：统一为「直接克隆到项目根目录」，删除原路径 A / B / C 三分法；`Use this template` 作为等价快捷方式保留一句说明。
2. `init-harness.py` 从对外主路径撤下，降为「项目已存在」这一例外场景的治理资产注入工具，不再作为装机步骤出现。
3. 版本固定示例与 §二 的克隆命令同步更新。

v1.17 变更：

1. **去除模板中的个人数据**：`project-tracker.md` 责任人字段、`AGENTS.md` 变更条目等处的个人名/项目名统一通用化，模板不再夹带任何个人字段。
2. `docs/harness/` 对外只保留一份通用《方法论速览》（README.md）；维护者的调研笔记、工具脚本、实战记录全部移出主干（`.gitignore` 忽略，本地保留），不再随模板分发。
3. 中英文 README 的 `docs/` 描述同步更新。

v1.16 变更：

1. 对外发布整洁化：维护者自身项目实战记录移出主干，本地保留、不再随模板分发。
2. 新增 `README.en.md` 英文版，降低非中文用户上手门槛。
3. 修复 README「路径 C 复制清单」与「项目结构」不一致：清单现列出 `docs/`，并标注为可选。
4. 新增版本固定说明：克隆时可用 `git clone -b harness-vX.Y` 锁定版本（此前默认只能跟随最新）。

v1.15 变更：

1. 新增 `scripts/init-harness.py`：把治理壳应用到目标项目，支持 `--lite`（只铺治理三件套 + evals，不克隆 14 仓、不强制填变量）与 `--full`（完整资产集）双形态。
2. 新增 `scripts/templates/evals-gate.yml`：可一键生成的 GitHub Actions PR 门禁，PR/push 时跑 evals runner，`--with-gate` 写入目标仓库。
3. 轻量模式是 kit 最灵活的入口，替代被移除的 install.sh：lite-first，多数团队无需克隆 14 仓即可上手治理。

v1.14 变更：

1. `evals/runner.py` 升级 v0.4，补全 14 个 case 实现（此前仅 4 个），详见 AGENTS.md 附录 C。

v1.13 变更：

1. 14 个角色技能默认使用公开 HTTPS 克隆，降低外部用户首次使用门槛。
2. 维护者需要推送技能仓库时，可通过 `python3 scripts/clone-skills.py --protocol ssh` 使用 SSH remote。

v1.12 变更：

1. `ai-harness-kit` 主仓库推送过滤 `skills/` 内容，只保留技能清单与空目录占位。
2. 初始克隆后通过 `python3 scripts/clone-skills.py` 拉取 14 个独立技能仓库。
3. 新增 `scripts/push-skills.py`，支持 14 个角色技能独立仓库逐个推送。
4. 新增 `.ai/harness.variables.example.json` 与 `scripts/apply-variables.py`，统一项目动态变量字段。

v1.11 变更：

1. 明确 `ai-harness-kit/skills/` 是角色技能维护入口。
2. 明确每个角色技能仍与 GitHub 同名独立仓库保持一致。
3. 新增 `scripts/check-skill-repos.py`，检查内置技能与独立仓库内容差异。
4. `.ai/SKILLS.md` 增加独立仓库链接列。

v1.10 变更：

1. 技能主源收敛到 `ai-harness-kit/skills/`，不再依赖外部目录。
2. `.ai/SKILLS.md` 按当前 14 个内置技能重建索引。
3. `scripts/refresh-skills.sh` 改为从仓库自身 `skills/` 生成技能索引。

v1.9 变更：

1. README 重写为对外用户使用版。
2. 明确 GitHub Template、直接克隆、已有项目复制三条使用路径。
3. GitHub 仓库开启 Template repository。

v1.8 变更：

1. 本地与远程仓库统一命名为 `ai-harness-kit`。
2. 克隆地址切换为 `git@github.com:genapohub/ai-harness-kit.git`。
3. README、AGENTS、project-tracker、SECURITY、evals 元信息统一更换为新名称。

v1.7 变更：

1. 后续维护主线当时切到 `ai-governance-example`，v1.8 已统一更名为 `ai-harness-kit`。
2. 使用方式收敛为“直接克隆到项目根目录”，不再要求执行装机命令。
3. README 去掉克隆后的自检命令，把脚本降为维护工具。
4. 标记 08 原始目录待备份恢复后再补融合。

v1.6 变更：

1. 合并早期 Harness 资料到 `docs/harness/`。
2. 仓库升级为可直接克隆的项目根目录模板。
3. 默认内置角色技能和多工具适配文件。

## 十、维护原则

1. 以后只维护 `ai-harness-kit`。
2. 不再保留多套分叉；所有治理资产统一收敛到 `ai-harness-kit`。
3. 新项目优先用 GitHub Template 创建。
4. 规则、技能、evals、适配文件都跟项目根目录一起进入版本控制。
5. 每次稳定变更都更新 `AGENTS.md` 版本段，并打 `harness-vX.Y` tag。
