# GitHub Copilot Instructions

本项目使用 Harness 治理规则。生成、修改、解释代码前，优先参考：

1. `AGENTS.md`
2. `project-tracker.md`
3. `SECURITY.md`
4. `.ai/SKILLS.md` 与 `.ai/skills-manifest.json`
5. `skills/` 中已克隆的角色技能

默认工作要求：

- 如果 `skills/*/SKILL.md` 不存在或数量不足，先提示按 `.ai/SKILLS.md` 中的 `git clone` 命令拉取本项目启用的角色技能。
- 按项目现有架构和命名约定实现。
- 新功能必须补测试或说明无法补测试的原因。
- 不生成硬编码密钥、客户隐私数据、生产环境连接信息。
- 不建议直接合并到 main / master。
- PR 描述必须包含变更原因、变更内容、验证方式和风险说明。
