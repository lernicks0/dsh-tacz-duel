---
name: minecraft-tacz-duel
description: 让 DeepSeek Harness 学习 Minecraft 1.20.1 Forge 的 TACZ 枪包并用独立游戏角色与用户进行枪械对战。通过随附原生客户端桥接读取枪械和可见对手状态，控制瞄准、正常射击、换弹和移动，记录每局经验。
---

# TACZ 学习与对战

面向 Minecraft 1.20.1 Forge，配套桥接以 TACZ 1.1.8-hotfix / Forge 47.4.23 构建。先读 [references/setup.md](references/setup.md)。本技能通过安装了 TACZ 的独立游戏客户端操作正常玩家；原有 Mineflayer 版用于原版世界，不具备本技能的模组握手、枪包同步或枪械控制接口。不要把 Mineflayer 的 `attack` 或普通右键当成 TACZ 开火。

把命令中的 `SKILL_DIR` 替换为技能资源目录绝对路径，`BOT_SESSION` 替换为**机器人游戏实例**的 `config/dsh-tacz-bridge/session.json`。需要 Node.js >=22，无 npm 依赖。dsh 与机器人客户端应在同一台主机；本地令牌不发给用户或第三方。

## 接入与学习

已有版本、昵称和实例路径直接沿用，只问缺失的必要信息。用户说“跟我对战”即授权在该对局中攻击用户指定角色；以其准确游戏昵称锁定目标，不扩大到其他玩家。用户未设规则时采用普通难度、当前装备、单局 180 秒或任一方死亡结束，先用简短说明告知默认值，无需反复确认。

1. `node "SKILL_DIR/scripts/tacz.mjs" observe --session "BOT_SESSION"`，确认独立客户端已进入同一服务器、机器人名字不同于用户、`state=ready`、菜单关闭。连接或 API 不兼容先排查，禁止伪造枪械数据。
2. `node "SKILL_DIR/scripts/tacz.mjs" learn --session "BOT_SESSION"`。读取当前实际加载的枪包，保存 `.runtime/learning/weapons.json` 和 `weapons.md`。按本次任务读取相关武器条目，掌握口径、弹匣、射速、射击模式、开镜/换弹、精度和后坐力字段。
3. 学习记录中的数值为枪包基础数据；配件、Lua 脚本和服务器配置可能改变实际性能。先核对 `observe.gun` 的实际武器 ID、弹药、膛内状态、有效 RPM、射击模式和操作锁；不要声称读取数据等于经过实战训练。
4. 开局前在机器人客户端的已有快捷栏选择并持有枪械；已开局时可用 `slot --json '{"slot":2}'` 调整 1–9 槽位，观察切枪完成再射击。不会生成枪械/弹药，不修改伤害、冷却或服务器验证。蓄力枪不由当前自动对战控制器处理，改选普通 TACZ 枪并说明原因。

## 与用户对战

读 [references/combat.md](references/combat.md)。默认假定用户安排了允许对战的场地和装备；只询问实际缺失的场地/回合信息，不自动编辑世界或账号设置。

```text
node "SKILL_DIR/scripts/tacz.mjs" duel-start --session "BOT_SESSION" --opponent "用户游戏昵称" --seconds 180 --difficulty normal
node "SKILL_DIR/scripts/tacz.mjs" runner-status
node "SKILL_DIR/scripts/tacz.mjs" observe --session "BOT_SESSION"
```

后台控制器每约 200 毫秒读取状态，原生客户端按游戏 tick 有限速地转向并通过 TACZ 客户端 API 开火。dsh 负责阶段判断和调整策略，不以模型调用频率逐帧操作。控制器使用实际可见的对手信息；失去视线只短暂记住上次看到的位置，不追踪墙后的实时坐标，也不在目标遮挡时继续开火。

根据实际观察决定远近距离、射击节奏、侧移和换弹。支持 `easy/normal/hard`，通过 [policy 接口](references/combat.md) 调整反应时间、转向速度、瞄准误差、偏好距离和点射节奏。当前控制器只做局部侧移/进退及简单碰撞、落差检查；复杂地图绕行、掩体选择与弹道预判尚需扩展。不能把基础侧移描述为学会了整张地图战术。

## 复盘与停止

每局结束读取 `.runtime/learning/experience.jsonl` 和 `.runtime/status.json`。区分 `shotsAccepted`（TACZ 接受的射击触发次数，连发可能发出多发）、自身生命损失、观察到的对手死亡和服务器核实的胜负。没有命中确认就不计算命中率，不把发包成功当成击杀。

用户要求“停/暂停/休战”时立即 `node "SKILL_DIR/scripts/tacz.mjs" stop --session "BOT_SESSION"`，再确认 `armed=false`。停止不会登出游戏。控制器反馈中断时，输入控制租约最多 600 毫秒；超时释放按键和瞄准。退出游戏、打开菜单、机器人死亡或对局时间到都会停止当前对局。

只根据实战记录做小幅可解释调整，保存枪械与策略心得到用户工作目录的 `tacz-progress.md`。更换枪包或 TACZ 版本后重新 learn，标明之前的经验是否仍适用。此技能积累的是可复用的武器数据与对局经验，不会修改模型权重。没有在用户服务器实测时，明确报告未验证的部分。
