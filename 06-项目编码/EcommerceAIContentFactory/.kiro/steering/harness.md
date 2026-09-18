# Harness Steering

所有 Kiro spec / task / implementation 都必须遵守项目根目录的 `AGENTS.md`、`project-tracker.md`、`SECURITY.md`、`.ai/SKILLS.md` 和 `.ai/skills-manifest.json`。

如果 `skills/*/SKILL.md` 不存在或数量不足，先提示按 `.ai/SKILLS.md` 中的 `git clone` 命令拉取本项目启用的角色技能。

执行顺序：

1. 先确认需求和边界。
2. 再更新或引用 spec。
3. 再实现代码。
4. 最后跑测试并更新 tracker。

禁止绕过 review、修改密钥文件、直接操作生产环境。
