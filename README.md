# GeoScholar

[中文](#中文说明) | [English](#english)

## 中文说明

GeoScholar 是一个可本地运行的 MCP 文献检索服务，面向地学、地球物理、测井、油气勘探、储层评价等研究场景，支持多平台检索、中英文联合扩词、学术元数据增强，以及合规下载工作流。

### About

面向地学与测井场景的多平台文献检索 MCP 服务，支持 CNKI、GEOPHYSICS、Petrophysics、OnePetro、SPE、SPWLA、EAGE、AAPG、万方、维普等来源的统一搜索与元数据增强。

这段文字也可以直接作为 GitHub 仓库的 About 使用。

### 当前支持的来源

- CNKI
- GEOPHYSICS
- Petrophysics（SPWLA 期刊）
- OnePetro
- SPE
- SPWLA
- EAGE / EarthDoc
- AAPG
- 万方
- 维普 / CQVIP

### 当前版本重点能力

- 一个 MCP 服务统一检索多个地学文献来源
- 支持中英文联合扩词，适合测井、物探、地质、油气工程等主题
- 新增学者检索工具，适合“老师 / 作者 + 机构 + 方向”这类查询
- 返回更适合科研筛选的字段，如摘要、关键词、机构、DOI、引用数、参考文献数等
- CNKI 采用协议优先、浏览器兜底策略，尽量减少可见浏览器弹出
- 万方与维普默认使用协议链路
- 元数据型国外源优先走 Crossref、OpenAlex、Unpaywall 等公开元数据能力
- 支持本地会话、合规下载、下载队列与作业状态查询
- 可在支持 `stdio` 的 MCP 客户端中使用

### 可返回的学术信息

- 标题
- 作者
- 摘要
- 关键词
- 机构
- DOI
- 引用数量
- 参考文献数量
- 期刊 / 会议 / 来源
- 卷期页
- 出版日期
- 出版方
- ISSN
- 学科主题
- 访问状态
- 详情页链接
- OA 链接 / PDF 链接（如有）

### MCP 工具

- search_literature
- search_cnki
- search_wanfang
- search_vip
- search_petroleum_literature
- get_article_record
- download_article
- queue_download
- list_download_jobs
- get_download_job
- get_auth_status
- describe_local_setup


### 各来源策略概览

| 来源 | 检索方式 | 搜索是否默认需要登录 | 说明 |
| --- | --- | --- | --- |
| CNKI | 会话 HTTP 优先，浏览器兜底 | 通常需要 | 依赖你自己的知网或机构权限 |
| GEOPHYSICS | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 元数据优先，受保护 PDF 仅作为可选后备 |
| Petrophysics | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 聚焦 SPWLA 期刊 |
| OnePetro | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 面向更宽的油气工程元数据池 |
| SPE | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 聚焦 SPE 会议、专著、论文与相关记录 |
| SPWLA | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 扩展到 SPWLA symposium / transactions 等记录 |
| EAGE / EarthDoc | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 聚焦 EAGE workshop、会议论文与 EarthDoc 记录 |
| AAPG | Crossref + OpenAlex + 可选 Unpaywall | 不需要 | 聚焦 AAPG Bulletin 与 Datapages 风格记录 |
| 万方 | 官方 grpc-web 协议检索与详情解析 | 搜索默认不需要 | 默认对齐官网首页的“全部资源”排序 |
| 维普 / CQVIP | 协议签名请求 | 搜索默认不需要 | 默认走协议搜索，受保护全文仍依赖你的访问权限 |

### 环境要求

- Windows
- Node.js 20 或更高版本
- 如果使用默认浏览器通道，建议本机安装 Microsoft Edge

### 安装

```powershell
cd D:\GeoSchlor-MCP
npm.cmd install
copy /y .env.example .env
npm.cmd run build
```

### 配置

复制 `.env.example` 为 `.env`，再按需修改。

常用配置示例：

```dotenv
CNKI_MCP_DATA_DIR=.mcp-data
CNKI_MCP_DOWNLOAD_DIR=downloads
CNKI_MCP_CACHE_TTL_MINUTES=720
CNKI_MCP_REQUEST_TIMEOUT_MS=30000
CNKI_MCP_REQUEST_RETRY_COUNT=3
CNKI_MCP_REQUEST_RETRY_DELAY_MS=1000
CNKI_MCP_BROWSER_CHANNEL=msedge
CNKI_MCP_BROWSER_HEADLESS=true
CNKI_MCP_CNKI_BROWSER_HEADLESS=false
CNKI_MCP_CNKI_RUNTIME_MODE=auto
CNKI_MCP_BROWSER_NAVIGATION_TIMEOUT_MS=45000
CNKI_MCP_CNKI_AUTH_TIMEOUT_MS=600000
CNKI_MCP_GEOPHYSICS_ISSN=0016-8033
CNKI_MCP_UNPAYWALL_EMAIL=
CNKI_MCP_OPENALEX_MAILTO=

```

`CNKI_MCP_CNKI_RUNTIME_MODE` 支持：

- `auto`：会话 HTTP 优先，失败时回退浏览器
- `http_only`：运行期只走协议，不自动打开浏览器
- `headed`：始终使用可见浏览器流程

### 认证

CNKI 通常需要先保存浏览器登录态：

```powershell
npm run auth:cnki
```

可选辅助命令：

```powershell
npm run auth:geophysics
npm run auth:wanfang
npm run auth:vip
```

说明：

- `GEOPHYSICS`、`Petrophysics`、`OnePetro`、`SPE`、`SPWLA`、`EAGE`、`AAPG` 的正常元数据检索默认不需要登录
- 万方和维普默认可直接搜索
- 如果全文本身受订阅或机构权限保护，仍需要你自己的访问权限

### 运行

开发模式：

```powershell
npm run dev
```

生产模式：

```powershell
npm run build
npm run start
```

### 通用 `stdio` 配置示例

下面是一个更通用的 MCP `stdio` 配置形式，适合迁移到支持本地 `stdio` MCP 的客户端中使用：

```json
{
  "mcpServers": {
    "GeoScholar": {
      "command": "node",
      "args": ["/absolute/path/to/GeoSchlor-MCP/dist/index.js"],
      "env": {
        "CNKI_MCP_BASE_DIR": "/absolute/path/to/GeoSchlor-MCP"
      }
    }
  }
}
```

如果你当前项目就在 `D:/GeoSchlor-MCP`，可直接写成：

```json
{
  "mcpServers": {
    "GeoScholar": {
      "command": "node",
      "args": ["D:/GeoSchlor-MCP/dist/index.js"],
      "env": {
        "CNKI_MCP_BASE_DIR": "D:/GeoSchlor-MCP"
      }
    }
  }
}
```

保存后请完全重启你的 MCP 客户端，让它重新连接新的 `stdio` 进程。

### 使用示例

- 在 GEOPHYSICS 中搜索测井方向最新文章
- 搜索 CNKI 中关于页岩气测井解释的文献
- 检索 2020 到 2026 年间的电成像测井相关论文
- 在 SPE 或 EAGE 中搜索与 `logging while drilling` 相关的会议论文
- 查询某位老师在特定机构和方向下的英文文献
- 用 DOI 获取完整文章记录
- 把某篇检索结果加入下载队列

### 合规说明

GeoScholar 采用合规优先策略：

- 不做验证码绕过
- 不做 Cloudflare 绕过
- 不做付费墙绕过
- 不抓取你的账号凭证
- 不隐藏登录行为
- 只使用官方链接或公开可访问链接进行下载

如果来源需要订阅、学校权限或个人账号，服务会明确提示，而不是尝试绕过。

### 仓库安全

本仓库默认不应提交以下本地敏感或缓存内容：

- `.env`
- `.mcp-data/`
- `downloads/`
- `.backup/`
- `release/`
- `.tmp-*`
- `.publish/`

如果你准备发布自己的分支，请在推送前再次检查工作区内容。

### 开发验证

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

## English

GeoScholar is a local MCP server for multi-source geoscience literature search. It is designed for geophysics, petrophysics, well logging, geology, reservoir evaluation, and petroleum engineering workflows.

### About

A multi-source MCP literature search server for geoscience and well-logging workflows, with unified search and metadata enrichment across CNKI, GEOPHYSICS, Petrophysics, OnePetro, SPE, SPWLA, EAGE, AAPG, Wanfang, and CQVIP.

### Supported sources

- CNKI
- GEOPHYSICS
- Petrophysics (SPWLA journal)
- OnePetro
- SPE
- SPWLA
- EAGE / EarthDoc
- AAPG
- Wanfang
- CQVIP / VIP

### Highlights

- One MCP server for multiple geoscience literature sources
- Chinese-English query expansion
- Scholar-oriented search for author + institution + topic queries
- Rich academic metadata in results
- Compliance-first download workflow
- Local session support for protected platforms
- Download queue and job tracking

### Recommended usage

- Use `search_petroleum_literature` for broad topic searches
- Use source-specific tools such as `search_cnki`, `search_geophysics`, `search_spe`, or `search_eage` when the source is explicit
- Use `search_scholar_publications` for professor or author lookups with institution and topic hints
- Use `sortBy="published"` for the newest papers

### Authentication

CNKI usually requires a saved browser session:

```powershell
npm run auth:cnki
```

Optional helpers:

```powershell
npm run auth:geophysics
npm run auth:wanfang
npm run auth:vip
```

Metadata-first sources such as GEOPHYSICS, Petrophysics, OnePetro, SPE, SPWLA, EAGE, and AAPG do not require login for normal search.

### Run

```powershell
npm run dev
```

or

```powershell
npm run build
npm run start
```

### Generic `stdio` MCP configuration

```json
{
  "mcpServers": {
    "GeoScholar": {
      "command": "node",
      "args": ["/absolute/path/to/GeoSchlor-MCP/dist/index.js"],
      "env": {
        "CNKI_MCP_BASE_DIR": "/absolute/path/to/GeoSchlor-MCP"
      }
    }
  }
}
```

### Compliance

GeoScholar does not bypass CAPTCHAs, Cloudflare, paywalls, or protected publisher access. It only uses official links or openly accessible copies and clearly reports when personal or institutional access is required.

### License

[MIT](./LICENSE)
