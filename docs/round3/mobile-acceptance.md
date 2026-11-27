# 第三轮 B · 手机性能与离线回归操作卡

## 复跑入口

在 B 工作树根目录，使用 Node.js（仓库要求 ≥22.13）与锁定依赖：

```powershell
npm ci
npm --prefix bookstore-source ci
npm run typecheck
npm run prerelease
npm run test:release
npm run release:locate -- dist-public
npx playwright install chromium # 仅当未安装锁定版本的 Chromium
node --test tests/mobile/real-device/sampler.test.mjs
node tests/mobile/real-device/simulate.mjs
```

模拟器自行绑定 `127.0.0.1:5621`，端口占用即停，不接管已有服务。与其他软件渲染任务错峰运行。默认顺序跑 360×800（Pixel 7 配置）及 390×844（iPhone 13 配置），两者实际都是**桌面 Chromium + SwiftShader**。`--360` 或 `--390` 用于单独复跑；`--warm20` 在功能操作后保持同一场景文档在前台至少 20 分钟再采样（两宽额外至少 40 分钟，建议单宽运行）；`--390 --warm-only` 只跑冷样本与同文档持续前台 20 分钟后的热样本；`--headed` 可复核确实发生的标签页可见性变化。`--pdf` 只生成自制六页夹具，无须预览服务。每轮目录独立：`test-results/round3-b/<UTC运行ID>/<宽度>/`，内有 `report.json`、分步骤样本和截图。截图是静态抽查，不能检出所有瞬时白屏或拖影。

## 采样口径

- 浏览器前台 rAF 回调间隔，首个回调只设基准；中位数、nearest-rank P95、最大间隔、超过 33⅓、50、100 ms 的数量、样本数和首末回调间实际时长。辅助指标 `callbackHz` 是回调数/实际时长，不是屏幕呈现或 GPU 帧率。`appRenderCallsCompleted` 取已有 scene 调试计数的窗口前后快照，是 CPU 侧渲染调用已返回数，仍不是 GPU 完成信号。
- 冷启动：干净站点数据和新会话，从首次进入可操作场景后立即采样 10 秒；另记录导航到可操作场景耗时。不是从首个 HTML 字节起的帧数。热态：同一导航、同一画质、同一全景机位，首次进入 explore 后至少 20 分钟，记录实际经过时间再采 10 秒。隐藏会放弃该次样本，不拼接隐藏前后时序；后台恢复单列。采样窗口内不截图、不滚动日志、不录 DevTools performance trace。
- 每一回调用两个时钟读数，写预分配 128 KiB 缓冲区；不做每帧 DOM/纹理读取或网络上传。样本导出含测到的回调内工作均值/总值，时钟量化可能显示 0；不包括时钟自身部分成本、调度、采样两端快照、结束后排序/导出。连接 Inspector 本身也可能有影响，应记录和保留同口径对照。
- Three.js 纹理、几何、程序数量不是显存字节；窗景驻留数回落/稳定是回收迹象，不证明驱动立即释放。页驻留数与关闭时的纹理差异要分开登记。浏览器 `performance.memory` 是非标准 JS 堆接口；若缺失标 `unavailable`。`deviceMemory` 只是粗粒度设备 RAM 档位，二者都不是全进程内存或 GPU 内存。工具不读显存和温控。GPU 风险单列：纹理计数随多轮操作单调增长、WebGL context lost、白屏/崩溃均须留证，不能据此推定超温或显存耗尽。

## 2026-11-27 桌面模拟证据与判定

本轮被测公开产物为 `release-info.commit=5bca57309096cfb2bd44a1623269219f5ca6cf44`、`revision=77272930232c9345`，核心/扩展包分别为 12,802,338 / 7,383,040 B。环境为 Windows `10.0.26300`、Node `v24.16.0`、headed Chromium `159.0.8154.6`、SwiftShader，逻辑处理器可用数 16。报告中的 commit 是被测 `dist-public` 的身份；后续只提交测试/操作卡不会改变该产物身份。

实际执行：

```powershell
node --test tests/mobile/real-device/sampler.test.mjs
node tests/mobile/real-device/simulate.mjs --390 --headed
node tests/mobile/real-device/simulate.mjs --390 --warm-only --headed
```

| 运行 | 结果与边界 | 证据 |
| --- | --- | --- |
| 采样器纯 Node 单测 | 3/3 PASS，0 FAIL，exit 0 | [日志](../../test-results/round3-b/sampler-static-2026-11-27T00-59-26-400Z.log) |
| 既有 360px 完整功能轮 | 01/02/03/05/06/08/09 共 7 项 PASS；04、07 NOT_TESTED | [360 报告](../../test-results/round3-b/2026-11-27T00-41-34-582Z/360/report.json) |
| 既有 390px 完整功能轮 | 同上；保留作首次短测对照 | [390 短测报告](../../test-results/round3-b/2026-11-27T00-41-34-582Z/390/report.json)、[短测日志](../../test-results/round3-b/simulation-resumed.log) |
| 新 390px headed 完整功能轮 | 同样 7 项 PASS；04 仍 NOT_TESTED；07 在此轮按参数跳过，由下一轮独立补测 | [390 复验报告](../../test-results/round3-b/2026-11-27T01-08-29-937Z/390/report.json)、[复验日志](../../test-results/round3-b/background-390-2026-11-27T01-08-29-537Z.log) |
| 新 390px headed warm-only | 01-cold、07-warm20 PASS；此模式不执行 02–06/08–09，这些功能结果引用上一完整轮 | [20 分钟报告](../../test-results/round3-b/2026-11-27T01-14-45-911Z/390/report.json)、[20 分钟日志](../../test-results/round3-b/warm20-390-2026-11-27T01-14-45-528Z.log)、[独立字段复核](../../test-results/round3-b/final-validation-2026-11-27T01-37-14-303Z.json) |

### 04 后台切回

既有两宽及新 390px 复验中，第二标签执行 `bringToFront()` 后，原场景在 4 秒轮询窗口内始终未观察到 `document.hidden=true`，报告原因为 `Chromium kept the scene visible while the second tab was foregrounded`。因此这些运行均只保留 **NOT_TESTED**，没有把冷样本已有的 `hiddenEvents=1` 当作切回事件，也没有注入或手工修改可见性。当前证据仅说明此 Windows/headed Chromium 自动标签切换路径不能提供可信 Page Visibility 切回证据，不推断所有窗口切换方式或真机行为。360/390px 模拟切回及两种真机切回仍待真实可见性变化证据。

### 07 同文档 20 分钟热态

390px warm-only 的独立字段复核为 `ok:true`，接受依据如下：

| 核对项 | 实测值 |
| --- | --- |
| 冷样本、留置基线/结束、热样本前后的 `timeOrigin` | 全部为 `1795742086514.4`，未重载场景文档 |
| `hiddenEvents` | 冷样本前后、留置基线/结束、热样本前后均为 1；留置及采样期间没有新增隐藏事件 |
| 实际留置 | `foregroundHoldMs=1200012`；场景时钟 `end.atMs-baseline.atMs=1200011.4 ms`；均不少于 20 分钟 |
| 其他时长 | `elapsedSinceExploreMs=1215506`；含热采样与截图的 07 步骤 `elapsedMs=1226365` |
| 固定状态 | 基线、结束及热样本前后均 `visible / explore / low / rendererDpr=1.25 / 390×844`，`webglContextLost=false` |
| 资源/堆快照 | 留置基线到结束纹理 125→125、几何 397→397、程序 43→43、驻留页 3→3、窗景 1→1；非标准 JS heap 70,728,722→71,109,238 B（+380,516 B），不是显存或泄漏结论 |

冷/热样本均 `status=complete`、`reason=complete`、`sampledMs>=10000`，且场景 CPU 侧渲染调用计数增长。数值如下；`callbackHz` 与 rAF 间隔都不是 GPU 完成或屏幕 FPS。

| 样本字段 | 01-cold | 07-warm20 |
| --- | ---: | ---: |
| `sampledMs / wallMs` | 10,229.3 / 10,982.8 | 10,057.9 / 10,404.4 |
| `intervals` | 14 | 10 |
| rAF `medianMs / p95Ms / maxMs` | 724.15 / 824.2 / 824.2 | 1005.8 / 1005.9 / 1005.9 |
| `over33_3ms / longOver50ms / severeOver100ms` | 14 / 14 / 14 | 10 / 10 / 10 |
| `callbackHz` | 1.369 | 0.994 |
| `appRenderCallsCompleted` 前后 | 15→30 | 1398→1409 |
| 采样缓冲 `bufferedBytes` | 131,072 | 131,072 |
| `timedCallbacks` | 15 | 11 |
| 回调内 `measuredWorkMs / meanMeasuredWorkMs` | 0 / 0（时钟量化） | 0.2 / 0.018 |

采样开销不包含全部时钟读取、调度、两端快照、排序和导出成本，不能把接近零的回调内工作解释为总开销为零。07 的 PASS 表示**同文档持续前台留置和样本有效性通过**，不表示性能达标：本轮 SwiftShader 冷/热样本所有记录间隔都超过 100 ms，桌面软件渲染长帧明显；既不据此推断真机同等表现，也不签发中端真机持续 30 FPS。

[热态全景截图](../../test-results/round3-b/2026-11-27T01-14-45-911Z/390/07-warm20.png) 可见正常全景，[新完整轮离线 PDF 截图](../../test-results/round3-b/2026-11-27T01-08-29-937Z/390/09-offline-reopen-and-pdf.png) 可见合成夹具第 1/6 页；静态截图不排除采样外瞬时异常。360px 的 20 分钟桌面热态仍未测。没有物理设备、供电/温控或 GPU 显存观测，iOS Safari 与中低端 Android Chrome 全部项目继续按下卡标记未测。

## 真机逐步操作卡（iOS Safari / 中低端 Android Chrome 各一轮）

1. **准备**：记录匿名设备代号、机型、系统与浏览器版本、屏幕刷新率（可见时）、供电方式/电量、系统省电、是否连调试器、温控官方读数或 `不可观测`。保持默认自动画质，记录是否自动低档。准备本机自制 PDF；可用上面的 `--pdf` 生成并本地传入设备。取同一公开构建并记录其 commit/revision。Android 可以在配备 ADB 的电脑上以 `node tests/offline/serve.mjs dist-public 5621` 起本地服务，`adb reverse tcp:5621 tcp:5621` 后从手机 Chrome 打开 `http://127.0.0.1:5621/`；结束后 `adb reverse --remove tcp:5621`。iOS 需要带可信证书的私有 HTTPS 测试源才能验证 SW；由设备实验室提供已授权的本地测试源和 Mac Safari Web Inspector。本轮未搭建对外服务。明文局域网 IP 不是离线验收的替代。
2. **01–02 冷态与自动画质**：清除测试源本地数据（只动本测试源），启新标签，手记从打开到进入全景的秒数。通过 Mac Safari Develop 菜单或桌面 Chrome `chrome://inspect/#devices` 进入场景 iframe 的 JS 控制台（执行 `typeof window.__debug` 应为 `object`；顶层通常为 `undefined`）。将 [sampler.js](../../tests/mobile/real-device/sampler.js) 原文粘贴执行一次，运行下面第一条。记录从可操作到采样开始的实际延迟；若远程调试导致明显延迟，标为冷态代理样本，不报严格冷启动。

   ```js
   var bSamples = [];
   bSamples.push(await round3Mobile.sample({label:'cold', durationMs:10000}));
   // 至少 20 分钟后、在同一场景机位和 foreground：
   bSamples.push(await round3Mobile.sample({label:'warm20', durationMs:10000}));
   JSON.stringify(bSamples, null, 2); // 每段完成即从 Inspector 本地复制为 JSON
   // 浏览器允许用户手势触发下载时，也可用 round3Mobile.download(bSamples)
   ```

   若控制台不支持顶层 `await`，分别用 `round3Mobile.sample({label:'cold'}).then(s => bSamples.push(s))`、`round3Mobile.sample({label:'warm20'}).then(s => bSamples.push(s))`，等待完成再导出。`before.atMs` 来自场景导航时间原点；连同手记首次 explore 时刻，留存热态实际经过时间。
3. **03–07 触屏回归与热态**：实点「看窗景与壁炉」→「逛后墙藏书」→「回到全景」→「坐下阅读」。交替次序连续翻页（公开版 6 页，往返共至少 10 次），每次确认页码真正推进；退出后逐一切到极光/森林/雪景/山景，等动画稳定，每档记录 `round3Mobile.snapshot()`（开始、每档、回全景各留一份）。切至其他 app 约 30 秒再返回；切走前后读 `timeOrigin`，检查仍是全景机位、未丢失状态，记录恢复延迟；重载单列，正常恢复后另采 `await round3Mobile.sample({label:'background-return'})`。切回后另留连续前台 20 分钟再按 02 采热态；留置两端用 `round3Mobile.snapshot()` 验证 `timeOrigin` 与冷样本一致且 `hiddenEvents` 在留置中不变，重载或中断则热态标未测并重开整轮。保持屏幕亮着，不更改档位、供电或系统省电。分别记录卡顿、白屏、重影、闪退，出现时记步骤、时间和是否可恢复。
4. **08–09 离线闭环**：打开「书屋工具 → 山窗共学 → 保存离线版」，等「已保存离线版」。确认受 SW 控制后，断开所有测试源连接（含 USB 反向代理或停止本地服务器）并开飞行模式，确认 Wi-Fi/蜂窝均关闭。关闭浏览标签后新标签打开**同一地址**；进入场景，实点翻试读书，点「导入本地 PDF」从已落盘的文件选择夹具，确认 6 页、前后翻页、放大缩小、退出。系统离线期间可用手记或匿名截屏，恢复连接后再取证；不要把重连后首次加载算离线成功。
5. **结果判定与归档**：以中端真机持续约 30 FPS 为产品目标；rAF 中位数接近或低于 33⅓ ms 只是初筛，还需查看 P95、长帧、可见交互及平台实证。按步骤分别标 `PASS / FAIL / 未测`；热态、两种真机和实机 GPU 温控不能从桌面结果替代。白屏、实际翻页或离线链路失败应在合并前复现并交主代理；真机未测不阻塞合入测试工具，但不签发真机验收。目录建议 `test-results/round3-b/devices/<匿名设备>-<UTC>/`。仅保存数值、合成夹具和脱敏截图；勿留邀请、URL 参数、昵称、序列号、真实 PDF 或凭据，勿上传外部。

| 真机报告 | iOS Safari | 中低端 Android Chrome |
| --- | --- | --- |
| 设备 / 系统 / 浏览器 / 供电 / 温控 | 未测 | 未测 |
| 01–02 冷态 rAF / 自动低画质 | 未测 | 未测 |
| 03–06 点位 / 切回 / 翻页 / 窗景驻留及异常 | 未测 | 未测 |
| 07 +20 分钟 rAF / 堆接口 / GPU 风险 | 未测 | 未测 |
| 08–09 断网重开 / 本地 PDF / 缩放翻页 | 未测 | 未测 |

实测环境仅有 Windows 桌面：未检测到 ADB 或已连接手机，未进行 Safari/Chrome 真机验收，也未在 Linux 复跑。
