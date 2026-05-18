# AI Reader

AI Reader 是一个基于 Next.js 和 Electron 的本地 AI 阅读器，支持导入 PDF、EPUB、TXT，围绕当前阅读上下文进行解释、翻译、问答和笔记整理。

## 当前能力

- 本地图书馆：导入、删除、搜索 PDF / EPUB / TXT。
- 桌面持久化：Electron 版本把书籍文件和书库状态写入系统 `userData`，避免大文件长期依赖浏览器 IndexedDB。
- PDF 阅读：页码跳转、缩放、目录跳转、阅读进度恢复、选中文本解释/翻译。
- EPUB 阅读：目录、分页阅读、主题色、字号、多字体、词间距、阅读位置恢复。
- TXT 阅读：纯文本阅读、主题和字号设置。
- AI 助理：基于当前页面内容问答，支持云端 OpenAI-compatible API 和本地 Ollama-compatible API。
- 划词工具：选中文本后可翻译、解释、添加笔记。
- 图书笔记：保存摘录和想法，并支持导出 Markdown。

## 技术栈

- Next.js `16.2.6` App Router
- React `19.2.4`
- Tailwind CSS v4
- Electron `42.1.0`
- `react-pdf` / `pdfjs-dist`
- `epubjs`
- `localforage`

## 开发环境

安装依赖：

```bash
npm install
```

启动 Web 开发服务：

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

启动 Electron 开发版：

```bash
npm run desktop
```

如果需要自动打开 DevTools：

```bash
npm run desktop:devtools
```

## 打包桌面 App

生成可直接运行的 macOS `.app`：

```bash
npm run desktop:pack
```

产物位置：

```text
release/mac-arm64/AI Reader.app
```

生成 dmg/zip 分发包：

```bash
npm run desktop:dist
```

## 验证流程

每次提交前至少运行：

```bash
npm run lint
npm run build
```

涉及 Electron 或桌面持久化时继续运行：

```bash
npm run desktop:pack
```

涉及阅读器 UI 时，需要在本地页面或 Electron App 中手动验证：

- PDF：导入、翻页、缩放、目录、选中文本。
- EPUB：切换主题、字号、字体、词间距、打开/关闭右侧栏、拖拽左右宽度、确认阅读位置不回退。
- AI 助理：配置面板、搜索词汇、提问输入框。
- 笔记：划词添加、编辑、删除、导出。

## 环境变量

如果使用服务端 DeepSeek API 路由，可在 `.env.local` 中配置：

```bash
DEEPSEEK_API_KEY=your_api_key_here
```

阅读器内也可以配置兼容 OpenAI Chat Completions API 的云端或本地模型服务。

## 数据位置

Electron 桌面版通过 `app.getPath("userData")` 保存数据：

- `books/`：导入的原始书籍文件。
- `library/library.json`：书库、笔记、阅读偏好等状态。

Web 开发版会回退到 IndexedDB / localStorage。

## 项目结构

```text
src/app/                    Next.js App Router 页面和 API
src/app/reader/[id]/         阅读器核心组件
src/utils/storage.ts         书库、文件、笔记和偏好存储
electron/                   Electron 主进程和 preload
scripts/desktop-dev.cjs      Electron 开发启动脚本
release/                    Electron Builder 输出目录
```

## 注意事项

- 本项目使用 Next.js 16，本地 `node_modules/next/dist/docs/` 是实现前必须参考的文档来源。
- EPUB 内容运行在 iframe 中，字体、字号、词距、主题等样式必须通过 `epubjs` 注入到 iframe 内部。
- 调整 EPUB 容器宽度后必须保持当前 CFI，避免连续拖拽导致阅读位置回退。
