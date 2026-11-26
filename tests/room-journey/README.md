# 山窗共学 · 浏览器验收

在工作树根目录，依赖安装后运行：

```powershell
node scripts/prepare-bookstore.mjs public
node node_modules/playwright/cli.js test -c tests/room-journey/playwright.config.ts
```

需要已有 Playwright Chromium（可用仓库现有 Playwright CLI 安装）。配置固定 `STUDY_TEST_PORT_OFFSET=340`，从现有 online 夹具计算端口；各占用 HTTP 5521、信令 7787、TURN 3818。启动时不接管已有服务。Windows 同工作树不同时重建 `.public-room`。

这套验收使用 Vite dev + `public` UI 分支，并加载由公开内容 profile 生成的正式同源 3D iframe。仅在 `ice.ts` / `roomSession.ts` 的测试夹具装载中选择仓库已有的本地网络分支；不改生产 bundle、会话计时阈值、邀请格式或窗口消息协议。超时用例阻断本地信令，不阻断书屋与 ICE。剪贴板夹具在浏览器执行成功/拒绝路径，不触碰系统剪贴板。

联机证据为同机 Chromium 两隔离上下文 + 本地信令/TURN；房主真实打开场景和共学面板，验证等待、复制邀请与诊断后，仅卸载房主 3D iframe 以避免 SwiftShader 并发卡顿，房主顶层应用和真实网络会话保留；访客全程保留真实场景。360/390 为 Chromium 触屏模拟，1280 为桌面模拟。真实设备/系统剪贴板/系统读屏器/真实跨网未测；公开发布构建单独验证。

报告、逐用例截图位置：`test-results/room-journey/run/`。截图只由测试在已断言的状态下主动拍摄，并遮盖邀请输入/回退字段。禁用 snapshot/自动截图/trace/video；私参只在测试和浏览器内存流转，不进入测试名、断言差异、诊断输出。重复运行会刷新结果目录。
