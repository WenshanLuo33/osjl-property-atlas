# OSJL Property Atlas — Three-Tab Update

本次更新只修改网页源码，不修改你的 CSV、照片或 Site Plan 文件。

## 放置方法

1. 解压 `OSJL_Website_Three_Tabs_Update.zip`。
2. 把里面的 `index.html`、`app.js`、`styles.css` 复制到现有 `M41020-OSJL` 文件夹，**覆盖这三个旧文件**。
3. 不要替换 `DATA`、`PICTURE`、`PLAN` 或 `START_WEBSITE.bat`。
4. 用原来的 `START_WEBSITE.bat` 打开网页，在浏览器按 **Ctrl + F5** 强制刷新。

目录结构示例：

```text
M41020-OSJL/
  index.html                    ← 替换
  app.js                        ← 替换
  styles.css                    ← 替换
  START_WEBSITE.bat            ← 保留
  DATA/
    OSJL_183_Stores_and_Owned_Properties_Updated.csv
    OSJL_Property_Portfolio_With_Ownership_Types_2026-11-02(2).csv
  PICTURE/                      ← 保留
  PLAN/                         ← 保留
```

如果你的两个 CSV 文件名不同，请在 `app.js` 顶部 `CONFIG` 的 `storeCSV` 和 `portfolioCSV` 中填写实际文件名。此前的 `HTTP 404` 表示路径或文件名不一致。

## 更新内容

1. **Property Map** — 弹窗及鼠标悬停不再展示 `Coordinate Source`，其余信息保留。
2. **Renovation Review** — 项目卡片中卫星图放在 Before/After 和 Site Plan 的**后面**，Google Maps 链接的前面。如果没有图片或 Plan，自动跳过空白部分。
3. **Ownership & Layout Types**（新增）— 只从 **Property Portfolio CSV** 获取项目；第一级按 `Property_Ownership_Type`，第二级按 `Retail_Center_Type`，每种类型下面是带可交互卫星地图的项目卡片。支持全文搜索、产权/类型筛选、分类分支跳转、展开/折叠。没有产权或类型分类时会分到 Unknown / Unclassified Layout。

卫星图允许拖动、双击、触控缩放以及 `+ / −` 按钮缩放；为了避免浏览很长的页面时意外缩放，默认关闭鼠标滚轮缩放。项目地图只在滚动至附近时初始化，以降低浏览器内存占用。

## 后续更新

- 修改两个 CSV 并保存后，网页在打开状态下每 20 秒重新检查数据；也可点击右上角 **Refresh**。
- 新增 `Property_Ownership_Type` 或 `Retail_Center_Type` 值后，第三页会自动产生相应分类，不需要改网页代码。
- 图片仍按现有 `renovation before`、`renovation after`、`plans` 的路径读取，也支持之前的默认文件名规则。

注意：Leaflet 地图库和 Esri 卫星影像需要联网。属性分组和卡片来自用户的 CSV，不代表产权已由第三方重新核实。
