# AGENTS.md · 企业级 AI 编程行为规范模板

> 适用于 Claude Code / Cursor / Aider / Continue 等所有支持 AGENTS.md 规范的 AI 编程工具。
> **本文件是宪法**：所有 AI 在本项目里做什么、不做什么、怎么做，必须遵守本文档。
> 项目级文件，复制到你的项目根目录，按需修改 `{{PROJECT_NAME}}` `{{TECH_STACK}}` 等动态变量字段。

---

## 第一部分：项目身份（必填区）

```yaml
# === 项目基本信息 ===
项目名：{{PROJECT_NAME}}
项目目标：{{PROJECT_GOAL}}
目标用户：{{TARGET_USERS}}
技术栈：{{TECH_STACK}}
代码仓库：{{REPOSITORY_URL}}
主要分支：{{MAIN_BRANCH}}（受保护）/ {{DEV_BRANCH}}（开发）
当前阶段：{{CURRENT_STAGE}}
项目知识地图：                  # AI 取业务上下文的索引（v1.2）；没有的行删掉，禁止凭空猜业务规则
  业务背景：{{BUSINESS_DOC}}
  接口协议：{{API_DOC}}
  数据模型：{{DATA_MODEL_DOC}}
  设计规范：{{DESIGN_DOC}}
  部署运维：{{DEPLOY_DOC}}
```

> **AI 必须做的事**：进入项目第一件事是读这份 YAML，理解项目背景再动手；需要业务上下文时按「项目知识地图」取，不要猜。
> **禁止做的事**：不了解项目就盲改代码。

---

## 第二部分：AI 角色定位

```yaml
# === AI 在本项目的角色 ===
主导级别：对话协作（AI 建议，人类审核）    # 不要轻易升级到"AI 主导"；人类"继续开发"≠ 免 review 合并，连续任务序列合并需人类明示"连续模式"（合并后仍需事后 review，可 revert）
触发场景：{{AI_TRIGGER_SCOPE}}
激活角色清单：                             # P0=常驻 / P1=按阶段激活 / P2=挂起；按你的团队角色体系定义，未勾选的角色不得被调度
  P0_常驻：【tech-lead-guide / frontend-dev-guide / backend-dev-guide / qa-testing-guide / devops-guide / team-orchestrator，按项目类型删减】
  P1_阶段激活：【按阶段勾选：product-plan-guide（需求/迭代）/ ui-designer-guide（UI 方案/视觉执行）/ data-analyst-guide（埋点/指标）】
  # 未勾选的角色 = 本项目未激活，orchestrator 不得调度；激活 P2 挂起角色前须先 refresh 白名单
工具白名单：见 第六部分
工具黑名单：见 第六部分
```

> **激活角色清单的作用**：本项目宪法只约束被激活的角色，未激活角色的边界规则不用写进本文档——这是项目宪法保持精简（AI 遵守率更高）的关键机制。

**主导级别三档**（按风险递增）：

| 档位 | AI 做什么 | 人类做什么 | 适用场景 |
|---|---|---|---|
| 对话协作 | 写代码、改代码 | 全量 review | 默认档，企业项目都用这个 |
| AI 主导 | 提 PR、写测试、跑 CI | 抽查 + 兜底 | 重构、低风险模块 |
| 全自主 | 自己提 PR 自己 merge | 仅看结果 | **本项目禁用** |

---

### 第二部分·角色状态（v1.4 新增 · 一人双角色开工声明）

> **适用前提**：本项目一人同时担任产品经理 + 独立开发者（或任何需要 AI 区分职责的项目）。**开工第一句必须声明本轮角色状态，禁止静默混用。**

```yaml
角色状态（开工首句声明，二选一；换脑必须显式声明 + 在 project-tracker 决策日志记一行）:
  PM_脑: 本轮只做需求分析 / 方案设计 / 评审 —— 不写业务代码、不改实现
  Dev_脑: 本轮只做技术实现 / 代码迭代 / 测试收口 —— 不改需求定义、不拍需求板
判定规则（产出物 → 脑）:
  PRD / BRD / MRD / 埋点 / 上线方案 / 访谈问题库 → PM_脑（禁动代码区）
  架构设计 / API / 前后端代码 / 测试 / 部署 → Dev_脑（禁拍需求板）
  可运行原型 / demo（验证假设用）→ PM_脑主导假设 + Dev_脑执行，属显式混合任务
禁止:
  PM 文档夹带代码实现决策（实现取舍留给 Dev_脑单独评审）
  Dev 代码夹带需求变更（先落 tracker 决策日志 → 回 PM_脑出方案 → 再动代码）
```

> **为什么**：一人双角色静默混用 = 方案文档混入实现细节、代码夹带未经评审的需求变更 → 方案与实现双向漂移。双角色无人制衡，纪律只能前置。

---

## 第三部分：AI 能做什么（白名单）

```yaml
能做：
  - 读懂现有代码并解释
  - 按规范写新功能（含测试）
  - 重构指定模块（需人类指定范围）
  - 写单元测试 / 集成测试
  - 跑 lint / format / type check
  - 生成数据库迁移脚本（人类 review 后执行）
  - 生成 API 文档 / OpenAPI spec
  - 生成 commit message / PR description
  - 解释报错并给出修复建议
  - 翻译注释（中↔英）
```

---

## 第四部分：AI 不能做什么（黑名单 · 红线）

```yaml
红线（违反即拒绝）：
  - 直接 push 到 main / master 分支
  - 删除未被 git 跟踪的关键文件
  - 执行 rm -rf / mkfs / dd 等破坏性命令
  - 修改 .env / credentials / secrets 相关文件
  - 调用生产环境数据库（read-only 可以，写不行）
  - 跳过 review 直接 merge 自己的 PR
  - 把客户代码 / 合同 / 财务数据喂给公网模型（敏感代码用 Ollama 本地推理）
  - 在 commit message / PR 描述里泄露密钥
  - 替人类做架构决策（架构变更需人类拍板）
  - 修改 CI/CD 配置（需 DevOps 角色人工审核）
```

> **越权处理**：AI 若发现自己被要求做红线事项，必须**明确拒绝并说明理由**，不能"勉强执行"。

---

## 第五部分：AI 工作流（标准流程）

> 双角色项目：开工第 1 步先按「第二部分·角色状态」声明本轮脑（PM_脑 / Dev_脑），再执行以下流程。

每个任务必须按以下流程执行：

```
1. 读上下文（AGENTS.md + project-tracker.md + .ai/SKILLS.md + 相关代码 + 最近 3 次 commit）
1.1 检查角色技能：按 `.ai/SKILLS.md` 确认本项目启用的角色技能；若 `skills/*/SKILL.md` 不存在或数量不足，**必须先向人类提示「角色技能尚未拉取」并给出 `.ai/SKILLS.md` 中的拉取命令**，待人类确认后再继续——不得在缺少技能的情况下假装具备该角色能力
2. 明确需求（向人类复述确认，不懂的问而不是猜）
3. 写方案（小改动 1-3 句话说明思路，大改动写设计文档）
4. 写代码（按 第七部分 代码规范）
5. 写测试（覆盖率 ≥ 项目基线）
6. 跑检查（lint / format / type check / 单测必须全绿）
7. 自我 review（对照 第八部分 checklist）
8. 提 PR（标题清晰，描述含：变更原因 + 变更内容 + 验证方式）
9. 等人类 review
10. 反馈迭代（人类提意见 → AI 改 → 再 review）
```

**禁止跳步**：尤其是第 2 步（明确需求）和第 9 步（等 review），跳了就属于"AI 越权"。

---

### 第五部分·工作纪律（v1.3 新增，来自真实项目实战复盘）

```yaml
多会话并行（最高优先）：
  - 同一仓库同一时间只允许一个 agent 会话工作
  - 开工前必查：git log -1（确认基线）+ git status（确认干净）
  - 开工前 git log --all --oneline 查是否已有同类实现（防重复开发）
  - 发现与预期不符的外部改动（文件被改/新增未知文件/分支漂移）：立即停止，向人类确认

多仓库操作：
  - 每个工作块开头确认当前仓库（pwd）与分支（git branch --show-current）
  - commit 前双确认：当前仓库正确 + 分支正确
  - 多仓库批量操作封装为脚本执行，禁止裸 cd 链连续操作

写文件：
  - 禁止多条 heredoc 拼接写多个文件（边界错位会写坏文件）
  - 用 Write 工具，或单 heredoc 单文件 + 写入后行数/尾部验证

口径声明：
  - 统计类实现前先注释声明口径（如"按完成时刻 updated_at 而非 created_at"）
  - 测试断言用真实业务值（如金额累加后应为 800 而非 640）
```

## 第六部分：工具白名单 / 黑名单

```yaml
工具白名单（允许 AI 主动调用）：
  文件操作：Read / Write / Edit / Glob / Grep
  Git 操作：git status / git diff / git log / git add / git commit / git push（仅限 feature 分支）
  包管理：npm install / pip install -r requirements.txt（需锁版本）
  测试：npm test / pytest / go test（只读，不写生产数据）
  容器：docker build / docker run --rm（不挂载主机目录）

工具黑名单（AI 不可调用）：
  破坏性：rm -rf / mkfs / dd / chmod 777
  生产数据库：mysql -h prod-* / psql prod-*（写操作）
  密钥相关：cat .env / printenv | grep SECRET
  网络外发：curl POST 到非项目内网地址
  CI/CD 改写：修改 .github/workflows / .gitlab-ci.yml
  远程执行：ssh prod-* / kubectl --context=prod
```

> **最小特权原则**：白名单以外的工具，AI 调用前必须先问人类，得到明确许可才能用。

---

## 第七部分：代码规范

```yaml
命名：
  变量：camelCase（前端）/ snake_case（后端 Python）
  类：PascalCase
  常量：UPPER_SNAKE_CASE
  文件：kebab-case（小写中划线）
  布尔变量：is_/has_/should_ 前缀

注释：
  函数必须有 docstring（解释做什么，不是怎么做的）
  复杂逻辑必须有行内注释（解释为什么这么做）
  TODO 必须带负责人 + 预计完成时间
  不要写"这是一个函数"这种废话注释

目录结构：
  src/        # 源代码
  tests/      # 测试
  docs/       # 文档
  scripts/    # 一次性脚本
  config/     # 配置

测试覆盖：
  核心业务逻辑：≥ 80%
  工具函数：≥ 90%
  UI 组件：≥ 60%
  新功能 PR 必须带测试，无测试 = 不通过 review
```

---

## 第八部分：Review Checklist（AI 产出物自检）

每次提 PR 前，AI 必须逐条对照：

```markdown
- [ ] 代码已通过 lint（无 warning）
- [ ] 代码已通过 format（与项目风格一致）
- [ ] type check 全绿（TS / Python type hints）
- [ ] 单测全绿，新增功能有对应测试
- [ ] 没动红线（见 第四部分）
- [ ] 没在白名单外调用工具（见 第六部分）
- [ ] 命名规范（见 第七部分）
- [ ] 注释清楚（docstring + 复杂逻辑行内注释）
- [ ] 没有遗留 console.log / print / debugger
- [ ] 没有写死的密钥 / 假数据 / TODO 占位
- [ ] commit message 清晰（feat: / fix: / refactor: / docs: 前缀）
- [ ] PR 描述含：变更原因 + 变更内容 + 验证方式
```

**没勾完的不能提 PR**。

---

## 第九部分：回滚机制

```yaml
回滚触发条件：
  - CI 红了且 10 分钟内修不好
  - 线上监控告警（错误率 > 阈值）
  - AI 产出代码被发现含安全漏洞
  - 人类 review 发现架构性问题

回滚动作：
  1. git revert <commit-hash>（首选，保留历史）
  2. git revert 失败 → git reset --hard <上一个稳定 tag>
  3. 立即通知人类 owner
  4. 在事故频道写时间线

版本标记：
  - 每个稳定版本打 git tag（v1.0.0 格式）
  - Harness 配置变更也走 tag（harness-v1.0）
  - 至少保留 5 个 tag 可回滚
```

---

## 第十部分：沟通约定

```yaml
与人类沟通：
  遇到歧义：问，不要猜
  遇到风险：先说风险再做，不要闷头做
  遇到完成：明确说"完成" + 列出产出物
  遇到失败：说"失败" + 失败原因 + 下一步建议，不要掩饰

PR 沟通：
  标题：<type>(<scope>): <subject>，type ∈ feat/fix/refactor/docs/test/chore
  描述模板：
    ## 变更原因
    ## 变更内容
    ## 验证方式
    ## 风险点
    ## 关联 issue

Code Review 沟通：
  AI 提的修改：人类不批就不 merge
  人类提的修改：AI 必须执行，不要争论风格
  分歧大时：升级到架构师 / Tech Lead 决策
```

---

## 附录 A：模板使用指南

1. **克隆本仓库到项目根目录**，本文件即为其中的 `AGENTS.md`
2. **第一部分（项目身份）必须填**，否则 AI 没法工作
3. **第二部分（角色定位）按项目风险等级选**，默认"对话协作"
4. **第三~六部分按需微调**，但红线不要轻易删
5. **第七部分（代码规范）和项目已有 ESLint / Pylint 配置对齐**，冲突时以工具配置为准
6. **第八部分 checklist 跑通才能提 PR**
7. **`evals/regression-cases.json` 套件**配合本文件使用，作为回归测试基线
8. **初始克隆不包含角色技能内容**，任务对话中 AI 发现技能缺失须先提示，按 `.ai/SKILLS.md` 的命令逐个 clone 拉取

---

## 附录 B：与 Harness 其他组件的关系

```
本文件（AGENTS.md）= 行为规范 / 宪法
├── project-tracker.md = 任务状态持久化（项目根目录）
├── SECURITY.md = 密钥 / 脱敏 / 合规三件套（项目根目录）
├── skills/ = 按需克隆的 14 个独立角色技能仓库（主仓库不跟踪内容）
├── .ai/skills-manifest.json = 技能仓库清单
├── .ai/SKILLS.md = 技能索引与克隆提示
├── evals/regression-cases.json = AI 产出物回归测试基线
├── .claude / .cursor / .github / .kiro = 多 AI 工具适配
└── docs/harness/ = Harness 方法论速览（可选，外部项目可删）
```

本文件定**原则**，其他文件定**执行**。

---

## 附录 C：Harness 版本管理（配置变更追溯）

> Harness 配置（AGENTS.md / SECURITY.md / regression-cases.json）属于生产级资产，变更必须可追溯。

### C.1 版本号约定

```
格式：vX.Y（X=大版本，Y=小版本）
大版本变更（X）：架构调整 / 红线增删 / 角色分级调整
小版本变更（Y）：条款细化 / 案例补充 / 工具分级调整
补丁版本：内部迭代不打 tag，仅 commit
```

### C.2 git tag 约定

```bash
# Harness 配置变更必须打 tag
git tag -a harness-v1.0 -m "AGENTS.md v1.0 + SECURITY.md v1.0 + evals v1.0"
git push origin harness-v1.0

# 后续每次配置变更
git tag -a harness-v1.1 -m "..."
git push origin harness-v1.1
```

**tag 命名规则**：`harness-vX.Y`（X.Y 与 AGENTS.md 底部版本号一致）

### C.3 变更触发条件（必须打新 tag）

- AGENTS.md 任一段内容修改
- SECURITY.md 红线 / 事故响应 / 模型分级调整
- regression-cases.json 新增/修改/删除 case

### C.4 变更清单（CHANGELOG）

每次打 tag 必须同步更新本节：

```markdown
## harness-v1.20（2026-09-14）
- 移除全部 `scripts/` 维护脚本（不再随仓库分发，本地保留）：拉技能改为 `.ai/SKILLS.md` 中逐条 `git clone`，动态变量改为手动替换占位符
- 保留并强化「拉技能」提示机制：工作流第 1.1 步要求 AI 发现 `skills/*/SKILL.md` 缺失时必须先提示人类并给出拉取命令
- PR 门禁模板由 `scripts/templates/evals-gate.yml` 移至 `.github/workflows/evals-gate.yml.example`，复制改名即启用
- 中英文 README、`.ai/SKILLS.md` 同步更新

## harness-v1.19（2026-09-14）
- 移除装机脚本 `scripts/init-harness.py`：kit 不再携带任何「铺壳 / 注入」脚本，对外统一为克隆到项目根目录
- §二「例外：项目已存在」改为手动复制资产清单；PR 门禁改为从 `scripts/templates/evals-gate.yml` 复制
- 中英文 README、`docs/harness/README.md` 中相关引用同步清理

## harness-v1.18（2026-09-14）
- 对外使用方式收敛为单一路径：统一「直接克隆到项目根目录」，删除原路径 A / B / C 三分法（`Use this template` 作为等价快捷方式保留说明）
- `init-harness.py` 从对外主路径撤下，降为「项目已存在」这一例外场景的注入工具，不再作为装机步骤出现
- PR 门禁改为从 `scripts/templates/evals-gate.yml` 复制到项目（存量项目仍可用 `--with-gate`）
- 中英文 README 的克隆命令、版本固定示例、附录 A 使用指南同步更新

## harness-v1.17（2026-09-14）
- 去除模板中的个人数据：责任人字段 / 变更条目中的个人名与项目名统一通用化，模板不含任何个人字段
- `docs/harness/` 对外仅保留一份通用《方法论速览》（README.md）；调研笔记 / 工具脚本 / 实战记录移出主干（`.gitignore` 忽略，本地保留）
- 中英文 README 的 `docs/` 描述同步更新

## harness-v1.16（2026-09-14）
- 对外发布整洁化：维护者自身项目实战记录移出主干（`.gitignore` 忽略，本地保留），不再随模板分发
- 新增 `README.en.md` 英文版，README 顶部互相链接
- 修复 README「路径 C 复制清单」与「项目结构」不一致（清单补 `docs/`，标注可选）
- 新增版本固定说明（`git clone -b harness-vX.Y`）；`docs/harness/` 语义由「历史沉淀」改为「方法论参考（可选）」

## harness-v1.15（2026-09-14）
- 新增 `scripts/init-harness.py`：把治理壳应用到目标项目，支持 `--lite`（只铺治理三件套 + evals，不克隆 14 仓、不强制填变量）与 `--full`（完整资产集）双形态，替代被移除的 install.sh，解决「kit 不够灵活」的痛点
- 新增 `scripts/templates/evals-gate.yml`：可一键生成的 GitHub Actions PR 门禁，`--with-gate` 写入目标仓库 `.github/workflows/evals-gate.yml`，观察期 `continue-on-error`、稳定后删行变硬
- lite 模式仅替换 `{{PROJECT_NAME}}`，其余 `{{...}}` 变量留待用户补，变量不全不报错

## harness-v1.14（2026-09-14）
- evals/runner.py 升级为 v0.4，补全此前缺失的 10 个 case，**实现 regression-cases.json 声明的全部 14 个 case（6 类）**——此前仅实现 4 个，名不副实（P0）
- 新增 case：code-001 命名 / code-003 测试覆盖率（结构代理） / spec-001 黑名单工具 / spec-002 PR 模板 / doc-001 PRD / doc-002 API / doc-003 选型 / collab-001 交接 / collab-002 升级 / security-002 脱敏
- doc-* 改用独立 markdown walker（覆盖真实项目「数字编号目录」）；collab-* 柔性定位 project-tracker.md（根目录 / docs/ / .ai/ 等常见位置）
- code-002 豁免改为路径感知（deploy/ scripts/ 任意层级、test_ / migrate_ 前缀文件），修复嵌套目录误报
- 实测：kit 自身 13/14；在多个真实项目上回归，捕获历史提交信息不规范（spec-003 命中）

## harness-v1.13（2026-09-14）
- 14 个角色技能默认使用公开 HTTPS 克隆，降低外部用户首次使用门槛
- 维护者需要推送技能仓库时，可通过 `python3 scripts/clone-skills.py --protocol ssh` 使用 SSH remote

## harness-v1.12（2026-09-14）
- `ai-harness-kit` 主仓库过滤 `skills/` 内容，只保留技能清单和空目录占位
- 初始克隆后通过 `python3 scripts/clone-skills.py` 拉取 14 个独立技能仓库
- 新增 `scripts/push-skills.py`，支持 14 个角色技能独立仓库逐个推送
- 新增 `.ai/harness.variables.example.json` 与 `scripts/apply-variables.py`，统一项目动态变量字段

## harness-v1.11（2026-09-14）
- 明确 `ai-harness-kit/skills/` 是角色技能维护入口
- 明确每个角色技能仍与 GitHub 同名独立仓库保持一致
- 新增 `scripts/check-skill-repos.py`，检查内置技能与独立仓库内容差异
- `.ai/SKILLS.md` 增加独立仓库链接列

## harness-v1.10（2026-09-13）
- 技能主源收敛到 `ai-harness-kit/skills/`，不再依赖外部目录
- `.ai/SKILLS.md` 按当前 14 个内置技能重建索引
- `scripts/refresh-skills.sh` 改为从仓库自身 `skills/` 生成技能索引

## harness-v1.9（2026-09-13）
- README 重写为对外用户使用版
- 明确 GitHub Template、直接克隆、已有项目复制三条使用路径
- GitHub 仓库开启 Template repository

## harness-v1.8（2026-09-13）
- 本地与远程仓库统一命名为 `ai-harness-kit`
- 克隆地址切换为 `git@github.com:genapohub/ai-harness-kit.git`
- README、AGENTS、project-tracker、SECURITY、evals 元信息统一更换为新名称

## harness-v1.7（2026-09-13）
- 后续维护主线当时切到 `ai-governance-example`，v1.8 已统一更名为 `ai-harness-kit`
- 使用方式收敛为 GitHub 直接克隆到项目根目录，不再要求执行装机脚本
- README 去掉克隆后的自检命令，`scripts/` 仅作为维护工具保留

## harness-v1.6（2026-09-13）
- 合并早期 Harness 调研沉淀到本仓库 `docs/harness/`
- 仓库过渡为 GitHub 直接克隆版
- 仓库升级为 GitHub 直接克隆版：治理三件套、Skills、evals、适配文件均位于项目根目录

## harness-v1.5（2026-09-13）
- install.sh 新增 `--with-local-skills`，可把本机技能目录中包含 SKILL.md 的角色技能安装到项目 `skills/`
- install.sh 新增 `--with-adapters`，可选生成 Claude / Cursor / GitHub Copilot / Kiro 适配文件
- regression-cases.json 新增 harness-001，runner.py 升级为 v0.3，检查项目根目录治理三件套是否落位

## harness-v1.4（2026-09-06）
- 第二部分新增「角色状态」机制：一人双角色（PM+Dev）开工首句声明本轮脑，换脑显式化 + tracker 留痕，禁止静默混用（PM 文档夹代码决策 / Dev 代码夹需求变更 = 双向漂移）
- 第五部分工作流开头加双角色指引行（声明脑 → 再走 10 步流程）

## harness-v1.3（2026-09-05）
- 第五部分新增「工作纪律」：多会话并行/多仓库操作/写文件规范/口径声明
- 第二部分合并授权语义明确：人类"继续开发"≠ 免 review 合并
- 迭代依据：真实项目开发复盘（14 起流程问题归因）

## harness-v1.2（2026-09-05）
- 本文件第一部分新增「项目知识地图」段：AI 按索引取业务上下文，不猜业务规则

## harness-v1.1（2026-09-05）
- 本文件第二部分新增「激活角色清单」机制：项目宪法只约束激活角色，未激活角色不得被调度

## harness-v1.0（2026-09-05）
- AGENTS.md v1.0 落地：10 部分 + 3 附录
- SECURITY.md v1.0 落地：密钥/脱敏/合规三件套
- regression-cases.json v1.0 落地：13 case / 5 类
```

### C.5 回滚 Harness 配置

如果新版本 Harness 配置导致 AI 行为异常：

```bash
# 查看 tag 历史
git tag -l "harness-v*"

# 回滚到上一个稳定版本
git checkout harness-v1.0 -- .

# 提交回滚
git commit -m "revert: harness-v1.1 → harness-v1.0（AI 行为异常）"

# 打回滚 tag
git tag -a harness-v1.0.1-revert -m "回滚到 v1.0"
git push origin harness-v1.0.1-revert
```


> _本附录定义 Harness 配置的版本管理与回滚约定_

---

> _维护原则：先骨架再追加细节。本模板先用默认值跑 2 周，再按实际踩坑迭代。_
> _版本：v1.20（2026-09-14）· ai-harness-kit_
