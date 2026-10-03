# 枪械、对战与策略

## 外部 CLI

先用 `node "SKILL_DIR/scripts/tacz.mjs" connect --instance "GAME_DIR" --bot "BOT_NICK"`；后续命令 `node "SKILL_DIR/scripts/tacz.mjs" ACTION`。`--runtime "可写目录"` 指定状态、经验与后台日志目录，默认技能目录 `.runtime`。同一局的所有命令需使用同一 runtime。

| ACTION | 用途 |
|---|---|
| connect | 按实际昵称固定机器人连接，支持共享目录 |
| prepare | 未开局时装备快捷栏普通枪、有补给时换弹，最多等待12秒 |
| check | 返回 readyToStart、blockers、ammoSupply、ammoBoxes，不射击 |
| observe | 读取机器人自身状态、快捷栏、实际持枪和当前能看见的指定对手 |
| catalog | 读取当前加载枪包的原始基础数据 |
| learn | 导出武器资料到 `.runtime/learning/weapons.json` 与 `weapons.md` |
| duel-start | `--opponent 玩家昵称 --seconds 180 --difficulty normal`，启动独立后台战斗循环 |
| runner-status | 读取状态文件；注意文件的时间与 PID，停止后不会继续更新 |
| policy | 用 `--json` 或 `--file` 提供部分参数，后台下一轮读取 |
| slot | `--json '{"slot":2}'` 选择快捷栏 1–9；可在开局前准备，必须核对机器人身份 |
| reload | 请求 TACZ 原生换弹，随后 observe 确認换弹状态/弹药变化 |
| bolt | 请求 TACZ 原生拉栓 |
| fire-select | 切换一次射击模式，再观察实际模式 |
| stop | 结束对局并释放按键/瞄准，保留游戏在线 |

`arm` 和 `frame` 是后台控制器内部命令；dsh 通常使用 duel-start / policy / stop。slot/reload/bolt/fire-select 可在未 armed 时准备；移动/瞄准/射击仍需有界对局。所有控制请求含 expectedUsername 并与真实昵称核对。

## 难度默认值

| 参数 | easy | normal | hard |
|---|---:|---:|---:|
| reactionMs | 700 | 350 | 180 |
| turnRate（度/游戏 tick） | 2 | 4 | 7 |
| aimErrorDegrees | 3 | 1.4 | 0.5 |
| preferredRange（格） | 12 | 14 | 16 |
| burstMs | 250 | 400 | 500 |
| restMs | 500 | 250 | 120 |
| strafe | false | true | true |

这些是对手行为参数，实际射速、散布、后坐力、换弹锁和伤害由 TACZ / 服务器决定。hard 也只读取可见对手；不能绕过遮挡或弹药检查。

policy 例子：`{"preferredRange":20,"burstMs":250,"restMs":400}`。允许 reactionMs 100–2000、turnRate 0.25–12、aimErrorDegrees 0–8、preferredRange 4–40、burstMs 100–1500、restMs 50–2000、strafe 布尔值。调整时记录动机，例如近距离持续空仓而改用更短点射；不能凭没有统计到的“命中率”调参。

## 应读的枪械字段

读取实际使用的枪的 `data`，不加载整本模组手册。

- ammo / ammo_amount / extended_mag_ammo_amount：匹配弹药与基础/扩容弹匣，实时剩余弹药看 observe.gun。
- bolt / bolt_action_time：关注手动拉栓与膛内状态，不把弹匣数直接当可立即射击数量。
- rpm / fire_mode / burst_data：理解单发、连发、自动；TACZ SUCCESS 是操作触发次数，不一定等于一发子弹。
- aim_time / inaccuracy / recoil：开镜等待、散布和后坐力。当前控制器反馈修正瞄准，但不保证拟真后坐力压枪曲线或任意枪包熟练度。
- reload：分清补弹与空仓重装，优先按原生同步 reloading 状态等待，不能仅凭配置秒数认定完成。
- bullet：基础伤害、弹丸数量与弹道字段。服务器/附件/距离会影响结果；不推断未核实的弹速单位，不承诺已实现远距离弹道提前量。
- charging / script / script_param：特殊机制信号。当前自动控制器拒绝蓄力枪；其他 Lua 武器需逐个校准。

## 对战流程和可核验结果

本控制器会在目标可见且反应时间到后瞄准、点射、侧移；按偏好距离进退；低生命或换弹时尝试后退；目标消失后先朝最后见到的位置观察，再转向搜索。移动仅检查近处碰撞和脚下安全，不替代寻路。

训练时先用已有装备做短局，保存 gunId、难度、射击触发数、自身生命损失、观察到的死亡与停止原因。没有安装命中/击杀事件统计器，故默认日志不提供命中率或可靠比分；胜负以用户观察和服务器反馈核实。总结实战心得后调整一个或两个策略参数，重新开局比较。

停止条件：用户 stop、任一方可观察的死亡、机器人失去游戏状态/打开菜单、无可用弹药、桥接失败、指定时限结束。机器人自动控制不会聊天，不对未指定玩家主动开火。旁人进入射线前景时客户端抑制射击。

无限箱是无限备弹，普通枪仍须正常换弹。canReload 是当前原生补弹条件，不是弹药数量；hasReserveAmmo/ammoSupply.usable 独立表达补给，背包直读枪以 hasInventoryAmmo 判断射击。读取 IAmmoBox 的 Creative/AllTypeCreative 和口径匹配，不能靠名字或 MAX_INT 猜。
