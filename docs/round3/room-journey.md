# 第三轮 D · 共学入口、邀请与离房交接

## 交付范围

- 独立工作树：`D:/work/study-room-round3-room-journey`；分支：`round3/room-journey`。
- 基线：`5bb5847fa389dc070826b78b27e7af9fbf595f52`（`release/offline-stability`）。入口与反馈 `5757c73` → 焦点与样式 `78abbc9` → 验收与交接（本报告所在提交；用 `git log -1 --format=%H -- docs/round3/room-journey.md` 查看完整 SHA）。
- 仅本地提交。未推送、未合并、未部署。联机结果来自本机隔离浏览器会话和本地信令/ICE 夹具；不代表现场设备或跨网验收。

## 变更与基线对照

| 文件 | 改动和原因 |
| --- | --- |
| [App.tsx](<../../src/App.tsx>) | 区分单机、信令连接、等待好友、点对点协商、已连接、失败；未取到房间码时仍可取消。有效输入复用现有解析器和会话；重试同一邀请，离房归单机。剪贴板拒绝时可选择完整邀请链接；过期复制结果不回写，复制诊断不携带房间字段。 |
| [FormalRoom.tsx](<../../src/scene/FormalRoom.tsx>) | 外链落地显示非模态反馈，不抢进屋或阅读焦点；共学面板接管 Tab、Shift+Tab、Escape，关闭后回到桌面、窄屏或阅读触发点。沿用同源 iframe 消息及来源检查。 |
| [styles.css](<../../src/styles.css>) | 暖暗和旧金样式；面板窄屏滚动、长文本换行、核心按钮点击尺寸与明确焦点。 |
| [浏览器用例目录](<../../tests/room-journey/README.md>) | 在公开版正式场景上跑独立 Playwright 验收；仅测试运行时复用本地网络夹具，不向生产添加控制钩子。 |

基线 **FAIL**：在冻结的未经注入 `5bb5847` 公开构建用坏邀请首次访问，地址参数被清除且状态已是 `failed`，但共学面板默认关闭，用户看到的场景没有失败反馈。见 [基线 Chromium 记录](<../../test-results/room-journey/baseline/browser-public.log#L2-L3>)、[基线落地截图](<../../test-results/room-journey/baseline/02-invalid-before-panel-1280.png>)、[基线打开共学后](<../../test-results/room-journey/baseline/03-invalid-open-1280.png>)。新增回归断言不开面板即可看见失败提示、面板内能回到单机，随后真实打开内置书并翻页。

本包未触碰会话/数据层的限额和状态机；聊天 64 条、便签 72 张和房主环境逻辑仍使用原实现。信令可用但无对端时可能持续等待；完整丢失 `~` 后缀后的 32 位合法旧码也无法仅靠现行解析器识别为截断。若需要区分「旧码」「缺少令牌」或给访客等待增设截止时间，应经会话层和邀请协议单独定义语义。

## 复跑准备

在工作树根目录执行：

```powershell
npm ci
npm --prefix bookstore-source ci
npm run typecheck
npm run prerelease
npm run test:release
node node_modules/playwright/cli.js test -c tests/room-journey/playwright.config.ts
```

最后一条需要已有 Playwright Chromium；没有时先运行 `node node_modules/playwright/cli.js install chromium`。公开构建会生成测试所需的 `.public-room`；若只跑浏览器测试，可先单独执行 `node scripts/prepare-bookstore.mjs public`。浏览器配置固定 `STUDY_TEST_PORT_OFFSET=340`，保留原始信令和协商超时阈值。

本包命令日志、测试输出和截图位于 [本地证据目录](<../../test-results/room-journey/>)，由 Git 忽略。浏览器截图仅截取页面，并遮罩邀请输入和回退链接；断言和报告只记录校验结果，不记录邀请实值。

### 构建与发布检查

| 验收项 | 结果 | 复跑命令与证据 |
| --- | --- | --- |
| 根项目、内置书屋依赖 | PASS | `npm ci`、`npm --prefix bookstore-source ci`；[根项目日志](<../../test-results/room-journey/commands/npm-ci.log>)、[内置书屋日志](<../../test-results/room-journey/commands/npm-bookstore-ci.log>)。Node `v24.16.0` / npm `11.13.0`。 |
| TypeScript | PASS | `npm run typecheck` · [日志](<../../test-results/room-journey/commands/typecheck.log>) |
| 公开构建与体积检查 | PASS | `npm run prerelease` · [日志](<../../test-results/room-journey/commands/prerelease.log>)；公开 revision `77272930232c9345`，公开核心包增加 6,711 B，场景包不变。 |
| 发布检查回归 | PASS | `npm run test:release` · [10/10](<../../test-results/room-journey/commands/test-release.log>) |

### 正式场景浏览器验收（同机模拟）

最终全量 **7/7 PASS**，耗时约 5 分 33 秒，无重试。见 [Playwright 报告](<../../test-results/room-journey/run/report.json>)。复跑用上面的 Playwright 命令；可追加 `-g` 按首列关键词筛选。截图位于 [结果目录](<../../test-results/room-journey/run/>) 的各用例子目录。

| 用例 / 关键词 | 结果 | 证据 |
| --- | --- | --- |
| `ordinary visit`：普通单机 1280，不启动联机，打开内置书并翻页 | PASS | `01-solo-entry-1280.png` |
| `keyboard crosses`：桌面从 iframe 真键盘打开、Tab/Shift+Tab 循环、Escape/关闭还焦 | PASS | 键盘回归断言 |
| `invalid external`：坏外链非模态、返回单机、真实翻页 | PASS | `03a-invalid-landing-1280.png`、`03-invalid-invite-1280.png`；对照基线缺陷 |
| `two isolated`：等待、复制成功、诊断脱敏、外链建联、退房和继续阅读、读中手动加入及还焦 | PASS | `02-waiting-for-friend-1280.png`、`04-connected-1280.png`；同时验证昵称和书页保留、现有聊天/便签/房主环境入口可达 |
| `stalls only`：取消连接、真实信令超时、同邀请重试、退房翻页 | PASS | 原阈值回归断言 |
| `360 · touch`：触屏入口、取消、长文本不横溢、剪贴板回退 | PASS | `05-masked-long-link-360.png` |
| `390 · touch`：触屏入口、取消、长文本不横溢、剪贴板回退 | PASS | `05-masked-long-link-390.png` |

### 本地浏览器验证边界

- Windows、Chromium headless + SwiftShader；360/390 为触屏模拟，1280 为桌面模拟。双会话用例在房主完成真实入口、等待和复制断言后，仅卸载房主的 3D iframe 以减少软件渲染争用，保持房主页面与会话；访客一直保留原场景。早次运行的双场景点击挂在 Chromium 的 actionability 阶段（伴随 WebGL stall）；最终按正常键盘 Enter 激活可见入口，仍验证真连接与真阅读。
- 真实手机、系统读屏器、系统剪贴板与两个设备跨网均 **未测**；实际系统权限与公网信令/TURN 需另验。放行仅建议针对本次 D 包变更，按上述三个提交顺序合入，不视为部署许可。

### 未注入的公开产物冒烟

**PASS**：直接提供 `dist-public` 静态文件（不注入测试网络），Chromium 1280 CSS px 首次到达正式书屋；共学默认关闭，实际打开后显示单机，关闭后焦点回到 iframe 入口；坏邀请在模态外可见，URL 已清理，内置书从 01–02 翻至 03–04 页，两路都无 WebSocket。命令：`$env:ROOM_SMOKE_FINAL='1'; node test-results/room-journey/public-smoke/smoke.mjs`。见 [记录](<../../test-results/room-journey/public-smoke/final.json>)。

### 既有用例兼容复跑

在 `78abbc9` 的隔离快照以偏移 `4420` 运行既有 `tests/online`，四条通过：默认单机不连网、双端建联、退出清理与成员计数、快速切换房间不串数据。共享工作树的初次复跑遇到 Windows Vite 文件监听 `EBUSY`；稳定快照未复现。此轮检查用的是非正式壳，不能替代本包的 iframe 验收。见 [版本与端口记录](<../../test-results/room-journey/compat/snapshot-final/run-metadata.json>) 和 [运行日志](<../../test-results/room-journey/compat/snapshot-final/console.log>)。
