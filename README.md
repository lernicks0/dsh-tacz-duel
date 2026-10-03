# DSH TACZ Duel

让 **DeepSeek Harness（DSH）** 读取 Minecraft 中实际加载的 TACZ 枪包，并操控独立玩家角色与你对战。

**状态：实验性 0.1.1。** 已通过 Forge 编译、重混淆、18 项策略与弹药回归测试、Java 瞄准数学测试及模拟桥接集成测试。**尚未完成真实 Minecraft 联机对战验证**；不能据此声称机器人已经训练成功或兼容所有枪包。

本项目包括 DSH 技能、零 npm 依赖的 Node.js 控制程序，以及开源的 Forge 客户端桥接模组。TACZ 需要原生 Forge 客户端；当前对战实现使用独立游戏客户端，原先设想的 Mineflayer 路线无法直接提供 TACZ 枪械控制。

## 版本与环境

| 组件 | 构建基线 / 要求 |
| --- | --- |
| Minecraft | Java 版 1.20.1 |
| Forge | 47.4.23；桥接声明支持 47.4.x |
| TACZ | 1.1.8-hotfix；桥接接口按 1.1.8 系列编写 |
| Node.js | 22 或更高 |
| DSH | 能加载文件系统技能，并执行本地 Node.js 命令 |
| 构建源码 | JDK 17、Gradle 8（已验证 8.10.2） |

用户、机器人及服务器需要相匹配的模组/枪包。机器人使用不同账号/昵称；推荐独立实例目录，新版也支持两个客户端共用实例目录；在线认证服务器需要相应的独立正版账号。本项目不提供游戏账号、服务器或 TACZ 本体。

## 安装

1. 下载本仓库源码或 Releases 中的技能压缩包。
2. 创建独立的机器人 Minecraft 实例，安装上述 Forge、TACZ 与所需枪包。
3. 将 `minecraft-tacz-duel/assets/dsh-tacz-bridge-1.20.1-0.1.1.jar` 放入**机器人实例**的 `mods`。只需机器人客户端使用桥接；共用 mods 目录时按昵称固定连接。
4. 将整个 `minecraft-tacz-duel` 文件夹复制到 DSH 能发现的技能目录，例如项目 `.dsh/skills`、`.agents/skills` 或配置的 `DSH_HOME/skills`。
5. 启动机器人客户端，进入你的服务器，准备枪和匹配弹药，关闭菜单。

Windows 可运行安装器，显式传入你的 DSH 技能目录与机器人实例目录；首次安装不覆盖已有文件；升级使用 `-Update`，先保存退出使用该实例的所有 Minecraft 窗口，旧技能和桥接会备份到 mods 外，保留技能运行记录：

```powershell
.\Install-TaczDuel.ps1 -SkillRoot "D:\DSH\skills" -BotInstance "D:\Minecraft\BotInstance"
```

安装器未指定 `SkillRoot` 时使用 `DSH_HOME/skills`，或 `~/.dsh/skills`；请根据自己的 Harness 配置核对发现路径。

## 开始一局

在 DSH 中调用 `/minecraft-tacz-duel`，告诉它你的游戏昵称和机器人实例路径。例如：

> 学习当前 TACZ 枪包。机器人实例是 D:\Minecraft\BotInstance，我的昵称是 MyPlayer，和我进行普通难度的 180 秒对战。

桥接为每个客户端记录独立 session，CLI 按真实游戏昵称选择机器人。两个客户端共用目录时，也不会因最后启动者覆盖兼容 session 而选错。手动诊断与启动：

```powershell
$cli = ".\minecraft-tacz-duel\scripts\tacz.mjs"
node $cli connect --instance "D:\Minecraft\BotInstance" --bot deepseek
node $cli learn
node $cli prepare
node $cli check
# 仅 readyToStart=true 时
node $cli duel-start --opponent lernicks --seconds 180 --difficulty normal
node $cli runner-status
node $cli stop
```

**无限弹药箱已按 TACZ IAmmoBox 接口识别**，报告无限/全口径标志、口径匹配和有效备弹来源。无限箱必须位于机器人可用背包；普通枪仍有弹匣容量并需要正常换弹。`canReload=false` 不能当成无备弹。新版桥接与新版技能必须一起更新。

可直接复制给 DSH 的完整示例见 [DSH-START.md](DSH-START.md)，逐步执行与故障处理见 [SKILL.md](minecraft-tacz-duel/SKILL.md)。

支持 `easy`、`normal`、`hard`；单局 10–600 秒。更多参数见 [对战说明](minecraft-tacz-duel/references/combat.md)；部署与故障排查见 [安装说明](minecraft-tacz-duel/references/setup.md)。

## 能力与限制

- 读取实际枪包的枪械目录、基础数据，以及当前持枪/弹药/操作状态；导出 `weapons.json` 和 `weapons.md`。
- 按可见目标进行有限速度的瞄准、点射、横移、距离调整、换弹；DSH 可修改策略参数。
- 只攻击明确指定的对手；失去视线时不读取对手实时位置。普通游戏规则决定伤害与枪械冷却。
- 每局记录发射请求、自身损失生命、观察到的对手死亡及退出原因。发射请求数量不等于命中数或击杀数。
- “学习”指读取枪包并积累可复用战术记录，不涉及训练模型权重。目前没有复杂地图寻路、完善掩体规划或弹道预测；蓄力枪暂不支持自动对战。
- 按昵称固定连接；开局前自动装备/装填，明确报告无限弹药箱和有效备弹，不用满弹匣的 canReload=false 推断无弹药。
- Node 控制循环约 200 ms；客户端输入租约最多 600 ms。死亡、菜单、断线、超时或显式停止会结束当前局。

本机桥接使用 `127.0.0.1` 和随机令牌；不要公开 `session.json`。运行时令牌、日志、学习记录、游戏实例和构建缓存均不应提交到仓库。

## 开发与验证

```text
npm test
javac -d .test-classes minecraft-tacz-duel/forge/src/main/java/dev/dsh/tacz/AimMath.java tests/AimMathTest.java
java -cp .test-classes AimMathTest
```

`npm test` 使用标准库，无需 `npm install`。集成测试运行模拟本机桥接，不会启动 Minecraft。

使用自己下载的 TACZ JAR 编译客户端模组；将 `JAVA_HOME` 指向 JDK 17：

```text
gradle -p minecraft-tacz-duel/forge build -PtaczJar="TACZ_JAR_ABSOLUTE_PATH"
```

产物位于 `minecraft-tacz-duel/forge/build/libs`，`build` 自动执行 `reobfJar`。首次构建会下载 Forge/Minecraft 开发依赖。预编译桥接 JAR 的版本、SHA256 和本地验证记录见 [build-info.json](minecraft-tacz-duel/assets/build-info.json)。

## 许可证与来源

本项目源码、技能和自编译桥接采用 **GPL-3.0-only**，见 [LICENSE](LICENSE)。仓库不包含 Minecraft、Forge、TACZ 本体或第三方枪包；这些依赖分别受原作者许可证约束。本项目不是 DeepSeek、Mojang、Forge 或 TACZ 官方项目。

接口参考：[TACZ 源码](https://github.com/MCModderAnchor/TACZ)、[TACZ 客户端枪械 API](https://github.com/MCModderAnchor/TACZ/blob/1.20.1/src/main/java/com/tacz/guns/api/client/gameplay/IClientPlayerGunOperator.java)、[Forge 客户端模组说明](https://docs.minecraftforge.net/en/1.20.x/concepts/sides/#writing-one-sided-mods)、[DeepSeek Harness 文件系统技能](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)。
