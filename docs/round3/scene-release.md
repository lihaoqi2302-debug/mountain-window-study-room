# 第三轮 A · 场景发布前检查

## 操作卡

在独立工作树运行（Node.js ≥22.13、Git 与 npm）。一次只运行一个会写产物的命令；不要在别的团队成员的工作树运行。使用已审阅的源码、依赖及本机环境，公开构建不要配置私有数据。

```sh
npm ci
npm --prefix bookstore-source ci
node scripts/scene-preflight.mjs
node --test tests/release/scene-preflight.test.mjs
```

- 只查源结构，不准备场景、不触碰 `dist-public`：`node scripts/scene-preflight.mjs --check-only`。可加 `--expect-commit <完整 SHA>`；若不加，记录当前 HEAD 和 dirty 文件数，dirty 不会阻止本地开发预检，但发布候选应从干净提交重建。
- 默认源是脚本所属 Git 工作树中的 `bookstore-source`，与启动目录无关。可传 `--source "含空格的绝对路径/bookstore-source"` 或通过 `BOOKSTORE_SOURCE` 指定同一个源；相对路径以工作树为准。指向其他目录的覆盖值会报错，即使设置了 `BOOKSTORE_ALLOW_EXTERNAL=1`。
- 源预检逐组件检查路径，拒绝符号链接、目录联接、路径别名和非普通/空文件，打开文件验证实际读权限。检查场景入口、资产库存、WebP 文件头、公开 profile 和现有两份来源清单。清单中只接受场景已有的资产 ID，来源 URL 仅作元数据，不读取远端、不作为待打开的路径；哈希检查格式，并非下载原图、证明许可或验证字节一致。新增资产或更改公开试读范围需要人工审阅源库存和上游构建契约。
- 构建调用现有 `prerelease.mjs`，由它准备 `.public-room`、运行 TypeScript/Vite，在 `dist-public.next` 上执行现有 `check-public-release.mjs`，通过后才交换 `dist-public`。不会继承 `PUBLIC_OUT`、`PUBLIC_PROFILE_FILE`、`PUBLIC_CORE_LIMIT` 或外部源覆盖来改写该轮审计的目标或限制。产物的页数、PDF.js、唱片和核心包体积仍由现有公开产物审计判定；源预检不替代它。该工具不是执行任意第三方源码的隔离器；运行中不要同时编辑源或移动目录。
- `[scene-preflight]` 结尾 JSON 报告包含 HEAD、revision、core/scenery 的字节数、总耗时和每个检查步骤的墙钟时间。`prereleasePhases` 为既有构建阶段日志标记间的时间，包含阶段间开销（如最后阶段包括后续交换），不是各子进程的精确 CPU 时间。`release-locate` 再核对 manifest、Service Worker、release-info revision 一致且产物 commit 等于开始时的 HEAD。任一错误或非零退出应停止交付；若错误发生于交换后（例如最后的定位检查），本地目录可能已换版，需先查 revision 再决定是否恢复，不能把它当成交换前失败处理。

## 旧产物保留演练（本机，需先成功构建）

确保本机 Playwright Chromium 可用，先确认 `127.0.0.1:5611` 无监听。Windows PowerShell：

```powershell
Get-NetTCPConnection -LocalPort 5611 -State Listen -ErrorAction SilentlyContinue
# 确认没有输出后再运行：
$env:SCENE_PREFLIGHT_DRILL = '1'
node --test tests/release/scene-preflight.test.mjs
Remove-Item Env:SCENE_PREFLIGHT_DRILL
```

POSIX shell：确认该端口空闲后执行 `SCENE_PREFLIGHT_DRILL=1 node --test tests/release/scene-preflight.test.mjs`。

演练先记录已审计旧产物的目录聚合 SHA-256。先运行错误源预检（校验阶段失败）；再用局部测试预加载器在 Vite 子进程启动处发出就绪标记，中断该子进程，验证 `prerelease` 退出失败并保留活动 `dist-public`。前后都用独立 Chromium context，通过同一个实际 HTTP 监听器打开站点和 `/bookstore/`，检查目录、试读数量、山景资源 HTTP 200、revision 及目录 SHA-256。测试阻止外部请求并禁用 Service Worker，避免缓存掩盖结果。验证范围限于预检失败与交换前中断；不涵盖交换两个目录的瞬间、断电、Service Worker 缓存回滚或生产部署。

## A 包实测

基线 `d5f7d584521645ade0f16cc46632f1d1836015bf`；工作树 `D:/work/study-room-round3-a-scene`，分支 `round3/a-scene`。Windows NT 10.0.26300.0、Node v24.16.0、npm 11.13.0、Git 2.54.0.windows.1、Playwright Chromium 159.0.8154.6。完整日志保存在该工作树的 `test-results/round3-a/`（未纳入 Git）。

| 门禁/演练 | 结果 | 本地耗时 | 证据 |
|---|---|---:|---|
| `npm ci` / `npm --prefix bookstore-source ci` | PASS | 44.300 s / 6.003 s | [根依赖](../../test-results/round3-a/npm-ci.log) / [场景依赖](../../test-results/round3-a/npm-ci-bookstore.log) |
| `node scripts/scene-preflight.mjs --check-only --expect-commit <基线>` | PASS | 见日志 | [源预检](../../test-results/round3-a/check-only.log) |
| `node scripts/scene-preflight.mjs` 冷构建 | PASS | 29.448 s | [冷构建](../../test-results/round3-a/cold.log) |
| 上条命令立即重复，暖构建 | PASS | 51.273 s | [暖构建](../../test-results/round3-a/warm.log) |
| `node --test tests/release/scene-preflight.test.mjs` | PASS，9/9；浏览器演练默认跳过 | 1.603 s | [源预检测试](../../test-results/round3-a/scene-tests.log) |
| `npm run typecheck` | PASS | 4.302 s | [类型检查](../../test-results/round3-a/typecheck.log) |
| `npm run prerelease` | PASS | 20.748 s | [公开构建和静态审计](../../test-results/round3-a/prerelease.log) |
| `npm run test:release` | PASS，10/10 | 5.690 s | [发布故障测试](../../test-results/round3-a/test-release.log) |
| `npm run release:locate -- dist-public` | PASS | 0.687 s | [revision/commit 定位](../../test-results/round3-a/locate.log) |
| `git diff --check` | PASS | 0.080 s | [差异检查](../../test-results/round3-a/diff-check.log) |
| `SCENE_PREFLIGHT_DRILL=1` 场景测试及本地 Chromium 演练 | PASS，10/10 | 65.158 s | [演练记录](../../test-results/round3-a/old-artifact-drill.json)、[测试日志](../../test-results/round3-a/scene-drill.log)、[源失败](../../test-results/round3-a/drill-preflight-rejected.log)、[构建中断](../../test-results/round3-a/drill-interrupted.log) |

冷构建从两套 `npm ci` 后、无 `dist-public`、`.public-room` 或 Vite 生成缓存的工作树开始，不包括依赖安装和操作系统文件缓存刷新；暖构建保留产物并紧接着重跑，两个样本是同机并行任务期间的墙钟快照，暖构建没有更快。冷/暖 revision 同为 `77272930232c9345`；核心 `12,802,338 B < 15,000,000 B`，扩展窗景 `7,383,040 B`。基线使用 A 脚本的开发阶段运行，日志会记录 dirty；验收应以干净候选重建。Linux 原生运行、交换瞬间故障和生产部署均未测；公网 15 分钟目标未登记，没有推送或部署。
