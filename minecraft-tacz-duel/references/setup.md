# 设置与兼容性

## 两个独立玩家

用户客户端继续由用户操作。另建机器人客户端，使用独立游戏实例目录和不同账号/昵称，安装相同的 Minecraft、Forge、TACZ 和相关枪包，进入同一服务器。正版服需要合适的独立正版账号；不能复用同一账号同时登录同服。桥接安装在机器人实例，不要装到用户正在操控的实例后夺走用户按键。

本次构建基线为 Minecraft 1.20.1、Forge 47.4.23、TACZ 1.1.8-hotfix。兼容声明只针对 1.1.8 系列；不能把“最新版”永久绑定为此版本。其他版本先核对接口与模组依赖。本地编译通过也不等于已验证所有枪包与服务器。

从包中的 `assets` 取桥接 JAR，放入机器人实例的 `mods`。这是客户端控制附加模组，不注册物品、方块或独立网络频道；服务器继续使用普通 TACZ 游戏规则，用户客户端无需安装此桥接。

启动机器人客户端，准备枪械和匹配弹药，连接服务器并关闭菜单。桥接启动后，在机器人实例的 `config/dsh-tacz-bridge/session.json` 写入本机随机端口和令牌。仅本机可访问，不能把这个文件对公网公开。

机器人实例与 dsh 同机。脚本 `--session` 指向这个文件即可，无需 MCP、Mineflayer 或额外 npm 安装。Windows 路径带空格时引用整个路径。复杂 JSON 用 `--file "请求.json绝对路径"`。

## 安装技能

把 `minecraft-tacz-duel` 放入 dsh 的项目 `.dsh/skills`、`.agents/skills`，或用户 `DSH_HOME/skills`（默认 `~/.dsh/skills`）。在会话输入 `/minecraft-tacz-duel`。与原有 `minecraft-mineflayer` 技能可并存，TACZ 对战调用本技能。

## 无人值守与恢复

- 开局后仅机器人实例临时关闭“失去焦点时暂停”，结束恢复原值。机器人死亡或打开菜单会结束当前对局；人工复活/重新就位后再开一局，不自动复活追杀。
- 控制器每 200ms 更新意图，客户端租约最长 600ms。反馈失败后按键会释放，后台控制器尝试 stop。对局硬性时限 10–600 秒，不提供无限自动攻击。
- `/call` 只接受本机令牌和 JSON，并拒绝带 Origin 的浏览器请求。没有聊天、shell、管理员指令、物品生成或改伤害接口。
- 桥接缺失：核对 JAR 是否放在正确实例，查看该实例日志中的 `DSH TACZ bridge ready`。
- 类型转换或接口错误：核对 TACZ 实际版本与混入接口；不要改为猜测包 ID 发送。
- `Client tick unavailable`：确认客户端没有卡死/停在加载中；过期命令不会延迟执行。
- `Runner lock exists`：看 `.runtime/runner.lock`、`runner-status` 和 `duel.log`。只有确认对应控制器已退出才清理此锁；不批量终止 Node/dsh 进程。
- 特殊枪包：蓄力、特殊 Lua 行为和复杂重装机制需要独立控制策略。默认学习接口仍能记录数据，自动控制器会拒绝蓄力武器。

## 从源码编译

`forge` 中保留附加模组源代码。使用 Java 17、Gradle 8（构建验证使用 8.10.2）和用户自己的 TACZ 1.1.8-hotfix JAR：

```text
gradle -p "SKILL_DIR/forge" build -PtaczJar="TACZ模组JAR绝对路径"
```

输出位于 `forge/build/libs`，安装前使用 reobfJar 后的产物。首次构建下载 Forge/Minecraft 依赖，需要能访问官方 Maven 和 Mojang 下载站；不用下载或重分发官方游戏资源。TACZ 本体、枪包和账号不随本技能分发。

来源：[TACZ 官方项目](https://github.com/MCModderAnchor/TACZ)、[TACZ 客户端枪械 API](https://github.com/MCModderAnchor/TACZ/blob/1.20.1/src/main/java/com/tacz/guns/api/client/gameplay/IClientPlayerGunOperator.java)、[Forge 单侧模组规则](https://docs.minecraftforge.net/en/1.20.x/concepts/sides/#writing-one-sided-mods)、[DSH 技能发现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)。
