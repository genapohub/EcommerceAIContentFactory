# 项目 Skills 清单

技能数量: 14
来源: `.ai/skills-manifest.json`
维护日期: 2026-09-14

> **初始克隆不包含 `skills/` 内容**（仓库只保留 `skills/.gitkeep` 占位）。
> 任务对话中若 AI 发现 `skills/*/SKILL.md` 缺失，必须先提示，按下节命令拉取后再开工。

## 一、拉取角色技能

在项目根目录逐条执行（按需只拉取本项目启用的那几个即可）：

```bash
git clone https://github.com/genapohub/backend-dev-guide.git skills/backend-dev-guide
git clone https://github.com/genapohub/data-analyst-guide.git skills/data-analyst-guide
git clone https://github.com/genapohub/devops-guide.git skills/devops-guide
git clone https://github.com/genapohub/frontend-dev-guide.git skills/frontend-dev-guide
git clone https://github.com/genapohub/graphic-design-guide.git skills/graphic-design-guide
git clone https://github.com/genapohub/growth-guide.git skills/growth-guide
git clone https://github.com/genapohub/monetization-guide.git skills/monetization-guide
git clone https://github.com/genapohub/operations-guide.git skills/operations-guide
git clone https://github.com/genapohub/product-plan-guide.git skills/product-plan-guide
git clone https://github.com/genapohub/project-mgmt-guide.git skills/project-mgmt-guide
git clone https://github.com/genapohub/qa-testing-guide.git skills/qa-testing-guide
git clone https://github.com/genapohub/team-orchestrator.git skills/team-orchestrator
git clone https://github.com/genapohub/tech-lead-guide.git skills/tech-lead-guide
git clone https://github.com/genapohub/ui-designer-guide.git skills/ui-designer-guide
```

已配置 SSH 时，把 `https://github.com/genapohub/<name>.git` 换成 `git@github.com:genapohub/<name>.git`，便于后续推送。

拉取后确认 `skills/<name>/SKILL.md` 存在，即可在任务中使用对应角色能力。

## 二、技能清单

| Skill | 本地路径 | 独立仓库 |
|---|---|---|
| backend-dev-guide | skills/backend-dev-guide | https://github.com/genapohub/backend-dev-guide |
| data-analyst-guide | skills/data-analyst-guide | https://github.com/genapohub/data-analyst-guide |
| devops-guide | skills/devops-guide | https://github.com/genapohub/devops-guide |
| frontend-dev-guide | skills/frontend-dev-guide | https://github.com/genapohub/frontend-dev-guide |
| graphic-design-guide | skills/graphic-design-guide | https://github.com/genapohub/graphic-design-guide |
| growth-guide | skills/growth-guide | https://github.com/genapohub/growth-guide |
| monetization-guide | skills/monetization-guide | https://github.com/genapohub/monetization-guide |
| operations-guide | skills/operations-guide | https://github.com/genapohub/operations-guide |
| product-plan-guide | skills/product-plan-guide | https://github.com/genapohub/product-plan-guide |
| project-mgmt-guide | skills/project-mgmt-guide | https://github.com/genapohub/project-mgmt-guide |
| qa-testing-guide | skills/qa-testing-guide | https://github.com/genapohub/qa-testing-guide |
| team-orchestrator | skills/team-orchestrator | https://github.com/genapohub/team-orchestrator |
| tech-lead-guide | skills/tech-lead-guide | https://github.com/genapohub/tech-lead-guide |
| ui-designer-guide | skills/ui-designer-guide | https://github.com/genapohub/ui-designer-guide |

## 三、本项目启用的角色技能

> 按项目实际情况勾选；未勾选的角色同样可拉取，但不作为本项目的默认角色。

- [ ] 产品经理 product-plan-guide
- [ ] UI 设计师 ui-designer-guide
- [ ] 前端开发 frontend-dev-guide
- [ ] 后端开发 backend-dev-guide
- [ ] 测试 QA qa-testing-guide
- [ ] 技术负责人 tech-lead-guide
- [ ] DevOps devops-guide
- [ ] 项目管理 project-mgmt-guide
- [ ] 数据分析 data-analyst-guide
- [ ] 增长 growth-guide
- [ ] 商业化 monetization-guide
- [ ] 运营 operations-guide
- [ ] 平面设计 graphic-design-guide
- [ ] 多角色调度 team-orchestrator
