# 参与开发

欢迎通过 Issue 提交游戏内测试结果，或用 Pull Request 改进客户端兼容、枪包支持和对战策略。

报告问题时附上 Minecraft / Forge / TACZ 版本、枪包与枪械 ID、操作步骤及已去除令牌的日志。请勿上传 `session.json`、账号信息、完整游戏实例或第三方模组 JAR。

提交前运行 `npm test` 和 README 中的 Java 数学测试。涉及 TACZ API 或客户端行为的修改还应使用 JDK 17 编译 Forge 模组，并记录实际游戏验证结果；模拟测试通过不能证明游戏内行为正确。重新发布桥接 JAR 时同步更新 `assets/build-info.json` 和 SHA256。

贡献代码按仓库 GPL-3.0-only 许可证发布。
