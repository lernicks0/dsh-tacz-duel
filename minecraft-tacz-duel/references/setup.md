# 安装、升级与排查

环境：MC Java 1.20.1、Forge 47.4.x、TACZ 1.1.8-hotfix、Node >=22。编译基线 Forge 47.4.23。双方与服务器需要兼容的模组/枪包；机器人使用不同昵称/账号，普通在线认证服务器需要各自合法账号。

将整个技能放入 Harness 实际发现的技能目录。候选有 DSH_HOME/skills、~/.dsh/skills、项目 .dsh/skills 或 .agents/skills；检查实际路径，不假定 cwd 即技能目录。更新实际加载的那份，避免仍读旧技能。

将 assets/dsh-tacz-bridge-1.20.1-0.1.1.jar 放入机器人实例 mods，移走旧桥接，只留一个版本。备份必须在 mods 外。**Java 修改需重启游戏才加载。** 先让用户保存退出，不擅自杀进程。两个客户端共用实例时，关闭两个窗口再换 JAR，重启后仍使用不同昵称。独立实例便于隔离，新版也支持共享目录。

Windows 仓库安装器：

```powershell
.\Install-TaczDuel.ps1 -SkillRoot "DSH技能根目录" -BotInstance "机器人实例目录"
# 已有安装升级，先关闭使用该实例的 Minecraft
.\Install-TaczDuel.ps1 -SkillRoot "DSH技能根目录" -BotInstance "机器人实例目录" -Update
```

-Update 会备份旧技能/桥接至 mods 外，并保留技能 .runtime，不影响其他模组。安装后让 DSH 重载技能/开新会话。

桥接仅监听 127.0.0.1，随机端口/令牌记录在 config/dsh-tacz-bridge/sessions/<Java PID>.json。兼容文件 session.json 会被最后启动的客户端覆盖，不能据此选择机器人。用 connect --instance ... --bot ... 只读检测昵称并固定连接，后续所有命令保持相同 runtime。bot-session.json 含私有令牌，不展示、不上传；游戏重启后重新 connect。

| 现象 | 下一步 |
|---|---|
| No reachable client | 核对实例、昵称、mods、日志 DSH TACZ bridge ready 后重试一次 |
| Old bridge/ammoSchema 缺失 | 新 JAR 未加载，检查实际 mods 后重启 |
| not-in-world | 机器人进入同一服务器，主菜单不算进入 |
| menuOpen=true | 在机器人窗口关闭聊天、背包、暂停等界面 |
| 有无限箱但 usable=false | 核对口径、持枪、虚拟备弹机制，箱须在机器人可用背包 |
| 换弹后 ammo 仍为 0 | 核对原生状态/脚本锁，请求成功不等于装填成功 |
| 不见目标 | 对手进入机器人视野，不使用墙后坐标 |
| Runner lock exists | 读 status 和锁内 PID，仅在确认该进程退出后清理这份锁，不批量杀进程 |
| API 不兼容/超时 | 核对 TACZ、游戏 tick、日志，不用普通右键替代原生接口 |

源码编译、策略测试与模拟桥接测试验证不同层次，不能代替真实游戏对战验证。
