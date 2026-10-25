# Edge 商店提交材料

产品：bili直播融合姬 · 版本：0.3.8

## 已整理

- listing.zh-CN.md：名称、简短说明、完整介绍、7 项搜索词与更新说明。
- review-notes.zh-CN.md：单一用途、权限与站点访问用途、远程代码说明、数据使用依据、审核操作说明。
- privacy-policy.zh-CN.md：隐私政策正文，已填写发布者 PeanutJelly 和支持邮箱 CrystalCracks@outlook.com。
- ../index.html：由隐私政策正文生成的公开网页；修改正文后运行 npm run site:privacy 并提交、推送。
- logo-300.png：沿用产品现有自有图标的 300 × 300 PNG，单独上传至商店。
- 工作区根目录 bili-live-fusion-edge-0.3.8.zip：扩展提交包，manifest.json 位于 ZIP 根目录；不包含源码仓库、测试与本文件夹。

## 填写顺序

1. 在 Partner Center 的 Edge 扩展开发者后台创建扩展，上传上述 ZIP。
2. 设置公开范围、市场和最接近娱乐或视频观看的现有分类。
3. 用 review-notes.zh-CN.md 填写用途、权限、远程代码与数据使用说明；按当前后台实际问题逐项核对。
4. Privacy Policy URL 填写 https://crystalcrack.github.io/bili-live-fusion/ 。
5. 简体中文列表中填写 listing.zh-CN.md 对应文案，上传 logo-300.png 和真实运行截图。
6. 填入审核操作说明，检查预览后由发布者提交。

## 素材规格与截图建议

根据微软官方发布文档，2026-10-25 查阅：

- 详细介绍：250–10,000 字符。
- 商店 Logo：1:1，推荐 300 × 300，最低 128 × 128。
- 截图：可选，最多 6 张，640 × 480 或 1280 × 800。
- 小宣传图：可选，440 × 280。
- 大宣传图：可选，PNG，1400 × 560。
- 搜索词：最多 7 项，每项最多 30 字符，所有项目合计最多 21 个词。

推荐准备 3 张 1280 × 800 的实际运行截图：

1. 工作台：两个已接入直播源、二分布局、画质和音画对轴。
2. 观看页：大画面、右侧弹幕列表和发送框。
3. 全屏：融合画面与底部播放控件，保留可见的弹幕互动。

若使用演示画面作为素材，配文写明“演示场景”。公开素材使用有权展示的直播内容，隐藏私人账号及无关信息。

## GitHub 与隐私政策网页

- 项目仓库：https://github.com/CrystalCrack/bili-live-fusion
- 隐私政策：https://crystalcrack.github.io/bili-live-fusion/
- 发布方式：GitHub Pages，main 分支的 /docs 目录。
- 隐私政策正文是 store/privacy-policy.zh-CN.md，网页是生成文件；更新时先修改正文，再运行 npm run site:privacy。

## 尚需发布者提供

- 当前版本的运行截图，以及最终市场、分类等账户字段。

尚未向 Partner Center 上传或提交。

## 官方依据

- 发布流程、权限说明、隐私、素材规格：https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension

## 本轮检查

本次只做扩展代码与资源静态检查、品牌名称核对及提交包内容检查；观看、全屏与真实直播体验由使用者按既有方式反馈。
