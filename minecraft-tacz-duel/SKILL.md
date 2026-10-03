---
name: minecraft-tacz-duel
description: 使用 DeepSeek Harness 操作 Minecraft Java 1.20.1 Forge TACZ 机器人客户端，与指定玩家进行枪械对战。适用于枪包学习、无限弹药箱识别、装备和换弹检查、自动瞄准射击、对战与复盘，通过随附原生客户端桥接执行。
---

# TACZ 对战：按顺序执行

你是游戏操作的执行者。用户说“和我玩/对战”时，实际执行下列步骤，直到成功启动对战或得到具体阻塞原因。不要只复述计划、展示命令或读完枪包就宣称开始。

环境：MC Java 1.20.1、Forge 47.4.x、TACZ 1.1.8-hotfix、Node >=22、桥接 **0.1.1 且 ammoSchema=2**。角色由正在运行的 Forge 客户端提供；调用 DSH 不会创建角色。不要用 Mineflayer attack、普通右键或模型逐帧调用替代原生控制器。

沿用用户已提供的技能目录、游戏实例目录和双方准确昵称，不重复询问。比如机器人 deepseek、用户 lernicks 时，操作对象一直是 deepseek，攻击目标一直是 lernicks。即使两个客户端共用目录，也必须 connect 按昵称连接，不盲用共享 session.json。用户要求对战即授权攻击其指定游戏角色；默认普通难度、180 秒、死亡/停止结束，告知后继续，不再要求“确认开火”。不生成装备，不修改伤害/弹药，不攻击其他玩家。

## 0. 定位技能与命令

先读 [setup.md](references/setup.md)。找到实际加载的技能目录，确认 scripts/tacz.mjs 存在。以下为 PowerShell 示例，替换路径占位符后执行；同一轮所有命令使用相同变量和 runtime。

```powershell
$TaczSkill = "技能目录绝对路径"
$TaczCli = Join-Path $TaczSkill "scripts\tacz.mjs"
$TaczRuntime = Join-Path $TaczSkill ".runtime"
node --version
```

Node 版本已满足无需 npm install。输出为 `{ok,value}`，后文的字段均在 value 内。ok=false 或退出码非零表示失败，不可当成功继续。不要原样执行占位符。如果工具每次开新的 shell，直接使用 CLI 和 runtime 的绝对路径，不假定上一条 shell 的变量还存在。

## 1. 按机器人昵称连接

```powershell
node $TaczCli connect --instance "机器人实例绝对路径" --bot "机器人准确昵称" --runtime $TaczRuntime
node $TaczCli observe --runtime $TaczRuntime
```

核对 connected=true，bot/observe.username 等于机器人昵称。connect 只读探测并固定连接，控制请求再核对身份。用户名错误立即重新连接，不能把机器人参数改成用户昵称来消除错误。

- not-in-world：客户端没进入世界，让机器人进入同一服务器，再继续。启动到主菜单不算进入。
- Old bridge：更新 JAR 并重启游戏再 connect；只改技能文本不会更新 Java 代码。
- 未找到机器人：核对实例目录、昵称、mods 与日志，诊断一次后报告缺项，不盲目重复。
- 多个同名客户端：让用户关闭重复窗口，不随便选一个。

runtime/bot-session.json 包含私有令牌，不展示内容、不上传。重启 Minecraft 后端口/令牌改变，必须重新 connect。

## 2. 学习当前实际加载的枪包

```powershell
node $TaczCli learn --runtime $TaczRuntime
```

确认 weaponCount>0。从返回 catalogPath 读取当前持枪/快捷栏枪的条目，理解 ammoId、弹匣、射速、模式、换弹、拉栓、散布与后坐力。基础数值不是配件/脚本修改后的实况，实时持枪以 observe 为准。只读枪包叫“已读取枪包”，不叫“实战训练成功”。

## 3. 准备装备，核对无限弹药箱

```powershell
node $TaczCli prepare --runtime $TaczRuntime
node $TaczCli check --runtime $TaczRuntime
```

prepare 从已有快捷栏选普通 TACZ 枪；空枪有可用备弹时请求原生换弹，最多等 12 秒，再返回检查结果。不会开局、移动或射击。没有枪就让用户把枪放进机器人快捷栏再 prepare，不能凭空获得物品。

**无限箱靠 TACZ IAmmoBox 接口识别，不猜中文名称、外观或一个很大的数字。** 先看 check.ammoBoxes 是否存在箱，再看 ammoSupply 是否真的供给当前枪。

| 字段 | 含义与动作 |
|---|---|
| ammoBoxes[].infinite=true | 确实检测到无限箱；count=null 表示无限，不是 0 |
| allTypes=true | 全口径无限箱；仍须放在机器人可用背包 |
| matchesHeldGun=false | 口径不匹配或没持枪；先装备，再核对 ammoId 和 gunId |
| usableForHeldGun=true | 此箱匹配当前枪且有弹药/无限备弹 |
| ammoSupply.source=infinite_box 且 infinite=true | 当前枪确实使用无限箱备弹 |
| source=gun_infinite_reload / creative_mode | 枪包无限备弹/创造模式，分别报告，不冒称检测到箱 |
| source=dummy | 武器虚拟备弹，可能覆盖背包无限箱补给 |
| canReload=false | 不等于没备弹：满弹匣、背包直读枪也会 false |
| gun.ammo / chambered | 弹匣数量/枪膛，普通枪有无限备弹仍需换弹 |
| inventoryAmmo=true | 背包直读枪，用 hasInventoryAmmo 判断能射击，不按 R 换弹 |

箱在用户背包、地上或世界箱柜里不会自动供给机器人。只扫描机器人 Forge 物品接口暴露的背包，不能宣称扫描世界。箱存在但不可用，报告 ammoId、匹配状态、当前 gunId，让用户移入机器人背包/换匹配枪。不要让用户为能用的无限箱再找有限子弹。

例：ammo=0、infinite=true、canReload=true → 有无限备弹，prepare 换弹后 check，不报“无弹药”，也不空枪开火。ammo=30、canReload=false、infinite=true → 已装填，能开局。普通无限箱不是无限弹匣。

**check.readyToStart=true 才继续。** false 时逐项处理 blockers：关闭机器人聊天/背包/暂停菜单、复活、装备、等待动画、补给。失败时报告字段与具体原因，不跳过检查、伪造成功或无限重复 reload。

## 4. 启动，并确认对战真的在运行

```powershell
node $TaczCli duel-start --opponent "用户准确昵称" --seconds 180 --difficulty normal --runtime $TaczRuntime
node $TaczCli runner-status --runtime $TaczRuntime
node $TaczCli observe --runtime $TaczRuntime
```

必须同时看到 started=true；runner-status.running=true 且 PID 与本次启动一致；observe.armed=true、username 是机器人、opponent 是用户。满足后才说“已开始对战”。旧 status 文件或只执行 learn 不算成功。

后台控制器每约 200ms 观察，按游戏 tick 限速瞄准、点射、侧移、进退、换弹和拉栓。让它持续运行，DSH 负责监督和策略，不逐发调用模型，不立即 stop。用户没改变要求时，每约 5 秒读 runner-status，变化时再 observe，每 15–30 秒给一句简短状态。连续约 15 秒未见目标，可提示对手靠近机器人视野，保持当前有界对局，不无限重开。失去视线仅记住上次可见位置，不能定位/射击墙后实时目标。

策略接口见 [combat.md](references/combat.md)。只有用户要求或实况支持才改一个或两个参数。死亡、菜单、断线、无有效补给、桥接错误或时限到会停止；读实际停止原因再处理。

## 5. 停止与复盘

用户说“停/暂停/休战”时立即执行，优先于所有学习与复盘：

```powershell
node $TaczCli stop --runtime $TaczRuntime
node $TaczCli observe --runtime $TaczRuntime
node $TaczCli runner-status --runtime $TaczRuntime
```

确认 armed=false，后台下一轮退出后 running=false。stop 释放控制但不登出，不杀 Java/其他 Node 进程，不自动重开。再战先复活、关菜单，再 prepare/check。

读取 runtime/learning/experience.jsonl 最新记录，报告实际 gunId、时长、shotsAccepted、自身生命损失、观察到的对手死亡、停止原因。shotsAccepted 是 TACZ 接受的射击触发，不是命中数；不能杜撰命中率、击杀或比分。把可验证经验保存到用户工作目录 tacz-progress.md；更换枪包后重新 learn，不修改模型权重。

当前只有局部移动和简单碰撞检查，没有复杂寻路/完整掩体规划，蓄力枪不支持自动对战。自动化测试通过不等于真实游戏实测；未实测时如实说明。
