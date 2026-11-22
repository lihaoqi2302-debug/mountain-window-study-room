# 山窗书屋 · 好友共学

[打开公网正式版](https://lihaoqi2302-debug.github.io/mountain-window-study-room/)

山窗书屋是一个可以单独阅读，也能邀请好友走动、入座、共读和聊天的 3D 空间。公网版保留精修山窗、壁炉、暖燕麦沙发和后墙的五本可拿取藏书。《地球 Online》开放前 6 页试读与完整目录。雨声和炉火声由浏览器合成，唱片机可以拖入或选取自己的音乐文件。

## 启动与构建

使用 Node.js 22.13 或更新版本。GitHub Actions 使用 Node.js 24。

| 用途 | 命令 |
| --- | --- |
| 公网正式场景 | `npm ci` → `npm --prefix bookstore-source ci` → `npm run build:public` → `npm run preview:public` |
| 本机完整书屋 | 放置相邻的 `cozy-bookstore` 项目 → `npm ci` → `npm --prefix ../cozy-bookstore ci` → `npm run build:formal` → `npm run preview:formal` |
| 基础示例和 GLB 实验 | `npm ci` → `npm run dev`，生产构建使用 `npm run build` |

公网正式版和本机完整预览分别默认使用 `http://127.0.0.1:5197/`、`http://127.0.0.1:5196/`。本机地址用于同机预览。邀请好友时从公网正式站生成邀请链接。旧版基础示例、当前公网正式版和本机完整场景的房间各自独立，升级后请在当前版本重新生成旧示例的邀请。

## 阅读、移动与离线

- 点击茶几上的书打开阅读器。手机可通过「坐下阅读」「看窗景与壁炉」「逛后墙藏书」「回到全景」一键切换。自由行走仍支持键鼠或触控。
- 从「书屋工具」可手动选择画质。自动档会读取设备类型、可用的内存与 GPU 信息、屏幕宽度。手动切换会重开场景。手机优先用「移动低」，长按或频繁切页时也只保留邻近页的高清纹理。
- 在「共学」面板点「保存离线版」，等待确认后可在同一浏览器断网重开同一网址。核心包包括默认山窗、内置书页、PDF.js 与本地环境音。额外三个窗景可勾选保存，本机完整版还可选择默认唱片。面板显示下载进度、已保存大小、新版本及清理入口。
- 离线打开后可拖入本地 PDF，具有标准字体、CJK CMap 和图像解码资源。PDF 在设备上处理，导入的书在当前页面阅读。受密码保护的文档请先合法解锁再导入。原独立 HTML 入口继续使用旧版 PDF 加载方式。
- 「专注」支持 25/5、50/10 与自定义时长。倒计时按结束时间恢复，今日统计仅存本机。联机时才发送当前专注或小憩状态，同屋可同时看见正在阅读的书名。房主选择共学雨声或炉火后，来访者可用角落提示自行开启声音和调音量。本地唱片仅在导入它的设备播放。

## 五分钟接入 TURN

普通访问不启用信令或查询 TURN。加入房间时默认使用多个公共 STUN 节点。没有好友时会显示寻找状态，信令或已开始的点对点协商超过约 14 秒会提示超时，也可以随时返回单机。

1. 在现有服务创建短效 TURN 凭据接口。Cloudflare Realtime 由现有后端/函数持有 TURN API token 并生成短效凭据。Metered 可使用其短效凭据发放方式。Coturn 的 `static-auth-secret` 同样只放在服务端，通过 TURN REST 生成临时用户名和密码。
2. 同源或 HTTPS 的 `GET` 地址返回标准 `RTCIceServer[]` 或 `{ "iceServers": [...] }`。如使用独立域名，允许 Pages 来源通过 CORS 读取。配置本机 `.env.local` 或 Actions 的仓库 **Variables**，将该地址放到 `VITE_ICE_ENDPOINT`，附加 STUN 地址用逗号分隔填到 `VITE_STUN_SERVERS`。Vite 变量、源码、静态 JSON 和 GitHub Pages 都是公开的，长效密钥只保留在凭据服务。
3. 重新构建后用两台不同网络的设备进房，点「网络诊断」。候选出现 `relay` 表示浏览器拿到了中继候选，选中链路显示「中继」才表示实际走了 TURN。接口不可用时会恢复公共 STUN。

[Trystero 的 WebRTC 配置](https://trystero.dev/docs/connections/) · [Cloudflare 短效凭据](https://developers.cloudflare.com/realtime/turn/generate-credentials/) · [Metered 凭据说明](https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/) · [Coturn](https://github.com/coturn/coturn)

## 资产清单与发布边界

`content.profile.json` 将场景、书稿与声音分开配置。

| 资产 | `public` | `full` |
| --- | --- | --- |
| 场景 | 同一精修 Three.js 场景，两档窗景 WebP | 同一精修 Three.js 场景 |
| 书稿 | `manuscript: "trial"` 和 `trialPages: 6`，完整目录只开放试读页的跳转 | `manuscript: "complete"`，34 页 |
| 声音 | `audio: "ambience"`，程序生成环境声、可导入本机音乐 | `audio: "local-record"`，本机源有默认唱片时可选保存 |

如以后授权公开全部正文，可把公网配置的 `manuscript` 改为 `complete`，并提供已授权的 34 个 WebP 文件。缩窄范围时应在干净的发布源目录重新导出。当前 Git 公开源码仅含 6 页，完整场景源使用 `node scripts/export-public-source.mjs` 从相邻书屋导出白名单文件。发布校验拒绝媒体录音、原始 PDF、内嵌唱片或超过清单的书页。窗景和画作的许可与来源位于 `bookstore-source/assets/`。

Actions 在 `main` 更新后安装锁定依赖、检查 TypeScript，构建并审计 `dist-public/`，使用 GitHub Pages 发布。环境开关仅允许提供浏览器可见的 ICE URL，可选 TURN 发放服务独立部署。站点构建支持 GitHub Pages 项目子路径。

## 示例 GLB 与协作数据

基础示例可放入 `public/models/study_room.glb`。缺失、下载或解码失败时回退至内置示例。Draco 运行资源随示例构建分发。可命名 `book_earth_online`、`book_undergrad_guide`、`seat_sofa`、`seat_desk`、`room_bounds`、`collision_*`、`spawn_player`、`camera_overview`、`camera_target`、`hearth_flame`，分别用于书本、入座、碰撞、出生位和壁炉钩子。

现有共享边界保留。聊天最近 64 条，明确分享的章节便签最近 72 张，晚加入从在线成员补齐。房主离线后保留最后的环境，原浏览器返回时恢复控制。所有成员离线时，新设备在等待状态，本机已收到的记录仍可查看。

## 验收范围

已在桌面 Edge 验证真实指针锁定下的跳跃、移动和大幅转向，验证窄屏触摸布局、书页和藏书归位。已在独立浏览器会话用真实公共信令验证好友共学和音频引导，并模拟完全断网验证冷启动与本地 PDF。手机真机性能及校园网、手机流量的 TURN 强制中继仍须按部署环境验证。此前用户已确认好友通过临时公网邀请成功加入。

项目代码采用 [MIT 许可](LICENSE)。依赖、字体、窗景和画作保留各自的许可。发布源码以外的本机书稿和唱片另有各自使用范围。
