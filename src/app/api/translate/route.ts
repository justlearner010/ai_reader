export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey === "your_deepseek_api_key_here") {
      return Response.json(
        { error: "请在本地 .env.local 或 Netlify 环境变量中配置有效的 DEEPSEEK_API_KEY" },
        { status: 500 },
      );
    }

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "你是一个翻译引擎。将用户输入的单词或短语翻译成中文。只输出翻译结果，不要说任何多余的话。" },
          { role: "user", content: text },
        ],
        temperature: 0.1,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DeepSeek API error:", response.status, errorText);
      return Response.json(
        { error: `翻译服务返回错误: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || "";

    return Response.json({ result });
  } catch (err) {
    console.error("Translate API error:", err);
    return Response.json({ error: "内部服务器错误" }, { status: 500 });
  }
}
