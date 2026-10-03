# 复制给 DSH 的提示词

以下示例使用机器人 deepseek、对手 lernicks；实例路径请按实际机器调整。

```text
请加载并执行 minecraft-tacz-duel 技能的最新 0.1.1 版本，实际控制游戏与我玩 TACZ。
机器人客户端的游戏昵称是 deepseek，我的昵称是 lernicks。
游戏实例目录是 F:\FWMAOZX\.minecraft\versions\gunplay-forge。
环境是 Minecraft 1.20.1 Forge、TACZ 1.1.8-hotfix。

先找到你实际加载的技能目录，核对 scripts/tacz.mjs 存在，使用 Node >=22。
不要把我的客户端当机器人，不要使用共享 session.json 猜测身份。
依次实际执行：
1. connect --instance "F:\FWMAOZX\.minecraft\versions\gunplay-forge" --bot deepseek
2. observe，确认 username=deepseek、ammoSchema=2、进入了世界且关掉菜单。
3. learn，读取这次真正加载的枪包与当前枪械资料。
4. prepare，再 check，检查快捷栏装备、弹匣/枪膛、换弹状态、ammoBoxes 和 ammoSupply。
5. readyToStart=true 后，duel-start --opponent lernicks --seconds 180 --difficulty normal。
6. runner-status 和 observe，核实 running=true、armed=true、实际机器人 deepseek、对手 lernicks，才告诉我已开始。
7. 持续监督当前有界对局，不只给计划，不启动后马上停，每约5秒检查状态。

这些是 tacz.mjs 的 action 与参数，不是 dsh 自身命令。
每条完整命令形如：node "技能目录/scripts/tacz.mjs" ACTION 参数。
所有命令用同一 runtime；如果工具每次开新的 shell，使用绝对路径，不能假定上一条 shell 的变量还存在。

特别注意无限弹药箱：读取 TACZ 实际接口标志，不看名字或很大的数字猜。
ammoBoxes[].infinite=true 表示检测到无限箱，allTypes=true 表示全口径。
matchesHeldGun/usableForHeldGun 及 gun.ammoSupply 才表示当前枪能不能用。
count=null 表示无限，不是没弹药；箱必须在 deepseek 的可用背包，而非我的背包/地上/箱柜。
无限箱提供无限备弹，普通空枪仍需要正常换弹，不能跳过换弹直接射击。
满弹匣时 canReload=false 是正常的，不要因此报“没有弹药”。
如果是旧桥接、身份错误、菜单未关、没进世界或装备缺失，给出具体 blocker 和下一步，不伪造成功、不无限重试。
默认规则已获授权，不再要求我确认开火。只对战 lernicks，普通服务器规则，不生成枪械/子弹。
我说“停”就立即 stop，并核对 armed=false；死亡/超时后不要自动重开。
对局结束读取最新 experience.jsonl，如实报告触发射击、生命损失与停止原因，不捏造命中率和胜负。
```
