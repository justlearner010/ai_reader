# AI Reader

我的第一个 vibe coding 项目：一个基于 Next.js 的 AI 阅读器，支持 PDF、EPUB、TXT 导入阅读，并提供 AI 解释、翻译和读书笔记功能。

## 功能

- 本地图书馆：导入并管理 PDF、EPUB、TXT 文件
- 阅读器：PDF 翻页、EPUB 阅读、TXT 文本阅读
- AI 助理：基于当前阅读上下文提问、解释选中文本
- 翻译：选中文本后快速翻译
- 笔记：保存划线内容和个人想法，并可导出 Markdown
- 阅读偏好：主题、字号、AI 提供商配置

## 开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

## 常用命令

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## 环境变量

如果使用服务端 DeepSeek API 路由，需要在 `.env.local` 配置：

```bash
DEEPSEEK_API_KEY=your_api_key_here
```

客户端阅读器里也可以配置兼容 OpenAI Chat Completions API 的云端或本地模型服务。
