# PicPuck Chrome 扩展

本仓库提供 **即梦**（jimeng.jianying.com）与 **Google Gemini**（gemini.google.com）页面上的浏览器扩展源码，供 **PicPuck** 产品与本地管理页通过 `postMessage` 联动执行填词、生成图片等操作。**源码完全开放，可自行审查。**

## 包含文件


| 文件                   | 说明                                            |
| -------------------- | --------------------------------------------- |
| `icons/`             | PicPuck 品牌图标（矢量 `logo.svg` 与各尺寸 PNG，供扩展与商店展示） |
| `manifest.json`      | MV3 清单与站点权限                                   |
| `background.js`      | Service worker：打开/定位受控标签页、执行脚本、日志聚合           |
| `content.js`         | 注入 PicPuck 管理端页面，将页面 `postMessage` 转发至扩展后台    |
| `jimeng-recorder.js` | 即梦页内容脚本（含录制与自动化所需逻辑）                          |
| `gemini-agent.js`    | Gemini 页内容脚本（操作日志等）                           |


## 安装（加载未打包扩展）

1. 克隆本仓库到本地。
2. Chrome 打开 `chrome://extensions/`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择**本仓库根目录**（内含 `manifest.json` 的目录）。

安装后，在 PicPuck 管理端按产品说明使用即可。

## 权限说明

安装时 Chrome 会展示本扩展需要访问的网站范围，主要包括即梦、Gemini、**生产站 picpuck.com / www.picpuck.com**，以及清单中的本地开发地址（localhost）。若你的 PicPuck 管理端部署在**其它** HTTPS 域名，请在本地修改 `manifest.json`：在 `host_permissions`、第一个 `content_scripts` 的 `matches` 与 `web_accessible_resources[].matches` 中追加该来源；并同步扩展源码里 `src/core/extensionAccessTokenLifecycle.js` 的 `isMcupFurnaceUrl`（与熔炉 Tab 代签 Token 一致）。保存后在 `chrome://extensions` 中重新加载扩展。