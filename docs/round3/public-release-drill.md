# E · 冻结候选的公开发布与回滚操作卡

## 复跑（本地，不发布）

在独立、干净的 E 工作树确认冻结提交 `d5f7d584521645ade0f16cc46632f1d1836015bf`，使用内置 `bookstore-source`，不要使用 A 的输出，也不要把生产 `.env`、凭据或私有素材复制到工作树。

```powershell
git rev-parse HEAD
git status --short --branch
npm ci
npm --prefix bookstore-source ci
npm run typecheck
npm run prerelease
npm run test:release
node --test tests/release/content-contract.test.mjs
npm run release:locate -- dist-public
git diff --check
```

保留干净冻结基线生成的整份 `dist-public`。再应用 E 的测试/文档提交（不重建该产物），运行：

```powershell
node tests/release/staging/drill.mjs
node tests/release/staging/prerelease-fault.mjs
```

需要项目锁定版 Playwright Chromium；如果本机尚未安装，先按现有 Playwright 流程 `npx playwright install chromium`。独占 `127.0.0.1:5651`，项目路径 `/mountain-window-study-room/`；占用时失败、不连接已有服务。E 未运行现有浏览器 suite：原 Pages 检查默认 5797，离线 suite 是 `5197+400+STUDY_TEST_PORT_EXTRA`；不要无偏移附带启动它们。新脚本复用现有 revision 派生工具及本地交换夹具。证据与临时副本保存在 `test-results/round3-e/`，不进入提交；多次运行可生成多个 `fixture-*` 目录。

### 通过判据

1. **先验产物。** 核对 `release-info.json` 的冻结 commit、`dirty=0`、内置场景源 Git tree；manifest、SW 头部与按文件内容重算的完整 revision 一致。记录总量和分包，核心严格小于 15,000,000 B。公开档保留 6 页试读、34 项目录（28 项锁定）、环境音但无默认唱片/录音包/原始 PDF；本地 PDF.js 模块、worker、CMap 和字体都随核心包发布。凭据检查是针对公开包的有限检查（文件名、应用 chunk 中的静态 TURN 地址/常见密钥格式，以及实际 Cache Storage 中的合成 `/ice` 响应排除），不等于对未知格式秘密的穷尽扫描。
2. **看入口与焦点。** 仓库子路径直达、JS/CSS、书屋 iframe 和直进书店都同源；站根与未知路由是 404，SW 没有扩大 scope 的响应头。用 Tab 找到 iframe 中共学入口，Enter 打开，检查首项和首尾焦点环，Escape 回到入口。无效邀请只在本地合成，观察可见状态、错误提示、打开后焦点以及回到单机后打开内置书并翻页；不要在正式站提交夹具邀请。
3. **更新和断网。** 同一 origin、scope、浏览器上下文保存冻结版；合成升级仅更改公开 `index.html`（同名探针）及其派生元数据。切换后调用浏览器原生 `registration.update()` 去除软更新节流，用控制器回报辨认完整 revision，而非只看脚本 URL。点更新后须保留两份完整核心缓存。浏览器设为离线，新标签打开并翻页；握手证据是 SW 响应标识、缓存状态和同名文件的 SHA-256。
4. **本地回滚。** 恢复联网，把同一个监听地址指回冻结版；再触发 SW 检查，确认界面报升级版 → 冻结版。点更新应提升已有冻结缓存，不重新下载核心资源（服务器访问只留 SW 脚本）。关闭服务器、再将浏览器设为离线并开新标签，重验阅读和同一 URL 的冻结版字节摘要，比对升级版摘要确实不同。浏览器会保留阅读进度；若已抵达末页，向前一页翻，仍须核实页码确实变化。
5. **故障门禁。** 本地目录交换夹具分别在暂存副本加入合成原始 PDF、把审计的核心限额压至 1 B：均须拒绝，`live` 树哈希保持成功发布后的值，最后可回滚目标目录。另跑 `prerelease-fault.mjs`，在本 E 工作树对真实入口注入 1 B 限额，断言具体审计诊断、退出 1、`.next/.prev` 均不存在且旧树 SHA-256 一致。两项演练都未覆盖真实构建被终止、第二次 rename 失败或线上交换。

`drill.json` 保存逐步计时、断言结果、revision、摘要和离线状态；`local-swap.json` 保存两种审计拒绝和目录摘要；`prerelease-fault.json` 保存真实入口的预期非零退出与原树摘要；PNG 为可见入口与无效提示的辅助证据。重新执行前把需要留档的上一份证据复制到本次专属证据目录，以防同名报告覆盖。

## 冻结基线记录

Windows x64、Node 24.16.0、npm 11.13.0。两套 `npm ci` 通过（根 43.3 s，书店 6.1 s）；`typecheck` 通过（4.7 s）；`prerelease` 通过（22.7 s）；`test:release` 10/10（5.6 s）；`content-contract` 5/5（0.34 s）；`release:locate` 通过（0.62 s）。冻结 revision `77272930232c9345`，核心 12,802,338 B（223 个文件），扩展窗景 7,383,040 B（6 个文件）；合成升级 revision `393ecae70112671a`。真实入口故障实测 54.7 s，预期退出 1，`.next/.prev` 无残留，旧树摘要一致。以上均为本机计时。

## 2026-11-27 收口实测

本轮在 `D:/work/study-room-round3-e-staging`、分支 `round3/e-staging` 执行，开始前 HEAD 为 `d14298ed14aaac6fa629ab74674ec8eb59466839`。只核验共同基线 `d5f7d584521645ade0f16cc46632f1d1836015bf` 已生成的 `dist-public`，正常演练没有从 E HEAD 重建。环境为 Windows x64、Node `v24.16.0`、Playwright Chromium `159.0.8154.6`（SwiftShader 软件渲染）；启动前 5651 无监听、无其他 round3/Playwright/headless 进程，B 代理确认暂停浏览器工作。

本轮证据目录为 `test-results/round3-e/run-20261127T010009309Z-final/`（本节以下相对路径均以它为根）。运行前把证据根目录原有的 21 个报告、日志和 PNG 全部复制到 `archive-before-final/`，包括旧 `drill-last-page.json`、`local-swap.json`、`prerelease-fault.*` 和截图；Git 忽略证据仍保留在 `test-results/round3-e/`。原始控制台输出另存 UTF-8 副本，便于复读。

### 实际命令、时间与退出码

日期均为 2026-11-27，时区 `Asia/Shanghai`；完整时间原值在各 `*-command.json`。

| 命令 | 开始 | 结束 | 耗时 | 退出码 | 日志 / 报告 |
|---|---|---|---:|---:|---|
| `node scripts/release-locate.mjs dist-public --json --no-api` | 09:00:29.482 | 09:00:29.663 | 178 ms（外层） | 0 | `release-locate-command.json`、`release-locate.json.utf8` |
| `node tests/release/staging/drill.mjs` | 09:01:50.959 | 09:04:24.586 | 153,624 ms（外层）；报告 153,270 ms | 0 | `drill-command.json`、`drill.log.utf8`、`drill.json` |
| `node tests/release/staging/prerelease-fault.mjs` | 09:04:43.756 | 09:05:04.912 | 21,152 ms（外层） | 0 | `prerelease-fault-command.json`、`prerelease-fault-command.log.utf8`、`prerelease-fault.json` |
| 上项内部 `node scripts/prerelease.mjs`（`PUBLIC_CORE_LIMIT=1`） | 由上项调用 | 由上项调用 | 20,333 ms | **1（预期故障）** | `prerelease-fault.log`；诊断 `Core offline pack 12802338 B exceeds 1 B` |

补充字段复核 `node test-results/round3-e/run-20261127T010009309Z-final/verify-acceptance.mjs` 退出 0，结果见 `acceptance-verification.json`、`acceptance-verification-retry.log`。首次内联辅助复核因 `Tee-Object` 的 UTF-16 定位日志解码问题退出 1，原日志保留为 `acceptance-verification.log`；随后仅修正辅助读取器的编码识别并以相同断言重跑，未改产品、测试或验收断言。

### 逐项判定与证据

| 项目 | 判定 | 实测原值与证据 | 真实 / 模拟边界 |
|---|---|---|---|
| 冻结产物定位与身份 | PASS | `commit=d5f7d584521645ade0f16cc46632f1d1836015bf`、`dirty=0`、manifest/SW=`77272930232c9345`、`consistent=true`；核心 12,802,338 B / 223 文件，扩展 7,383,040 B / 6 文件。见 `release-locate.json.utf8`、`drill.json` 的 `frozen-artifact-audit`。 | 对现有冻结文件做真实本地审计；未重建。 |
| 子路径、入口与键盘焦点 | PASS | 根/未知路由 404，JS/CSS、iframe 同源，共学入口焦点环与 Escape 返回通过。见 `drill.json` 对应步骤、`direct-entry.png`。 | 本地 5651 模拟 Pages 项目子路径；真实 Chromium 场景，不是公网 Pages。 |
| 无效邀请、回单机与阅读恢复 | PASS | 可见「邀请链接不完整」、焦点到关闭按钮、query 移除；页码 `01–02 → 03–04`。见对应步骤与 `invalid-invite.png`。 | 邀请为本地合成夹具，无外发。 |
| 内置书店与 PDF.js | PASS | 6 页、34 项目录、28 项锁定、无默认唱片；PDF.js 模块/worker/CMap/字体路径均可访问。见 `direct-bookstore-and-pdfjs-paths`。 | 真实冻结公开资源的本地 HTTP 检查。 |
| 保存 A 与合成 ICE 排除 | PASS | A=`77272930232c9345`，核心缓存 224 项，`syntheticIceResponsesCached=0`。见 `save-frozen-and-check-credential-endpoint-exclusion`。 | `/ice` 为本地合成响应；检查范围遵循上文有限凭据检查说明。 |
| A → B 更新与保存 | PASS | B=`393ecae70112671a`；更新前 `revision=B/savedRevision=A`，保存后 B/B，A、B 两份核心缓存均保留。见 `upgrade-worker-and-save`。 | B 是仅修改同名 `index.html` 及派生元数据的合成升级，不是生产发布。 |
| B 离线新标签与翻页 | PASS | SW 回报 B/B；同名 `index.html` SHA-256=`715709f0c847bccdd38286c9511f0998efe727e0c8a34a21aab222efd7cf1932`；页码 `03–04 → 05–06`。见 `new-tab-offline-on-upgrade`。 | 浏览器 context 离线，本地服务此步仍运行；资源由 SW 返回。 |
| B → A 回滚与零核心重取 | PASS | 回滚前 `revision=A/savedRevision=B`，保存后 A/A；缓存顺序 A、B；`coreRedownloads=0`，服务访问只有 `/mountain-window-study-room/sw.js`（2 次）。见 `rollback-to-retained-frozen-cache`。 | 同一本地监听地址在合成 B 与冻结 A 间切换；不是线上交换。 |
| 停服断网恢复 A 与末页翻页 | PASS | 服务关闭且浏览器离线后，SW 回报 A/A；同名资源 SHA-256=`57b4b7b93395d4d9e9ac15f239598c6f659af1c129e455faf372be147d07d78f`，等于冻结 A 原值且不同于 B；`fromServiceWorker=true`；页码 `05–06 → 03–04`，方向 `previous`。见 `new-tab-offline-after-rollback-with-server-stopped`。 | 真实本地停服和浏览器离线；验证已缓存 A，不推断未缓存用户的零下载。 |
| 浏览器诊断 | PASS | `externalAttempts=0`、`socketAttempts=0`、`pageErrors=0`、`httpErrors=0`；`drill.json` 为 `ok:true`，12/12 步全为 `ok:true`。 | 仅本机 loopback 与浏览器上下文。 |
| 本地目录交换两种审计故障 | PASS | 原始 PDF 与 1 B 核心限额均拒绝，`liveSha256=eeae3b87d9ceec88be0a49c380b8304099198c9e2fa12a7d44a8fd2c8916f95f` 保持成功发布值；可回滚 A。见 `local-swap.json`。 | 本地隔离目录与合成故障；总耗时 2,757 ms，不含 Actions/Pages/CDN。 |
| 真实 prerelease 的 1 B 故障 | PASS | 子进程退出 1，诊断匹配；`before=after=317cecf3c79dfde780e58628dc5b1182a2d29a1f96ee1464dba470452e3253f2`，`nextExists=false`、`prevExists=false`、`ok=true`。见 `prerelease-fault.json`、`prerelease-fault.log`。 | 真实入口在 E HEAD/dirty 状态构建到 `.next` 后被审计拒绝；冻结 `dist-public` 字节树未变，不把这个故障构建当作正常重建。 |
| 公网 Pages 部署、发布后只读核验 | **未测** | 本轮 `realPages=false`，无部署、无生产写操作。 | 本地结果不能替代真实 Pages 验收。 |
| 公网 CDN 同步、混代与传播时延 | **未测** | 无 CDN 请求或计时。 | 上线后仍须按停线条件复核。 |
| Linux | **未测** | 本轮仅 Windows x64。 | 不推断 Linux 路径、rename 和构建结果。 |
| 真实端到端发布耗时 | **未测** | 未覆盖 Actions 排队、真实构建发布、Pages 部署、CDN 传播及发布后核验，因此没有公网端到端耗时。 | 上表 153.270 s、20.333 s 等仅为本机对应步骤计时。 |
| 真实构建被终止、第二次 rename 失败、线上目录交换 | **未测** | 未注入这些故障。 | 仍按上文故障门禁边界处理。 |

本轮正式验收无 FAIL；旧末页失败只作为历史回归证据保存在 `archive-before-final/drill-last-page.json` 和 `archive-before-final/browser-last-page.log`，没有删除或改写。合成 B、邀请、ICE、审计故障均为本地夹具；真实部分是冻结文件审计、本地 HTTP/Chromium/SW/Cache Storage、停服断网以及真实 prerelease 故障入口。未进行推送、部署、生产访问或其他工作树写操作。

## 主代理操作：上线及回滚

| 操作 | 操作者检查 |
|---|---|
| 发布前保留上一版 | 保留上一成功部署的完整 Pages 产物与完整 commit、revision、SW 摘要、Actions 运行 ID；同步保存本次的对应证据。不要用单个文件替换一整版。 |
| 审核候选 | 在目标提交的干净工作树跑根门禁；确认发布参数只含公开 STUN/ICE 端点之类的客户端配置，不把共享密钥或临时凭据放进构建变量。冻结 E 证据只对应 D；若合入 A 或其他改动，须对实际候选重验。 |
| 部署 | 由主代理使用现有 Pages workflow；核对 Actions 中 build → audit/test → 上传 `dist-public` → deploy 的顺序及部署记录。E 本地练习不触发这一步。 |
| 发布后只读核对 | `npm run release:locate -- https://<owner>.github.io/mountain-window-study-room/ --json --no-api`；等待 CDN 同步并对照实际部署 commit、manifest、SW 和元数据。只打开正常入口和只读书目，检查关键请求、实际作用域与更新提示，不提交邀请。`release:locate` 的退出 0 不代表 `consistent:true`。 |
| 回滚 | 若实际站点验证失败，停止后续发布；恢复上一整份受审计的产物（按既有批准流程重新发布对应提交/产物），不逐文件覆盖。在原项目子路径和同一 origin 再核对 commit/revision/SW，待 CDN 同步后复核。已有目标版缓存的浏览器点离线更新，验证恢复旧缓存；目标缓存已经被清理的用户通常需要联网重新保存，勿承诺零下载。 |

**停止条件：** 审计失败、试读/曲目/凭据/PDF.js 超出公开策略、核心包达到限额、commit/revision/SW 不一致、子路径资源错位、入口/错误焦点不通、无法断网打开或翻页、回滚时同名字节不匹配、拒绝后 live 树变化，均应阻止发布。CDN 混代时保持停线判定，复验后再升级；取得一致性之前不要宣布成功。真实 Pages、外部服务、CDN 时延、生产用时、Linux、真机并未由 E 演练覆盖。
