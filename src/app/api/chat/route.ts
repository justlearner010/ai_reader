export async function POST(request: Request) {
  try {
    const { message, bookText } = await request.json();

    if (!message) {
      return Response.json({ error: "message is required" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey === "your_deepseek_api_key_here") {
      return Response.json(
        { error: "请在本地 .env.local 或 Netlify 环境变量中配置有效的 DEEPSEEK_API_KEY" },
        { status: 500 },
      );
    }

    const systemPrompt = bookText
      ? `你是一个只输出 JSON 字符串的技术字典，禁止任何自然语言寒暄。
输出格式严格为：
{
  "term": "术语名称",
  "definition": "一句话精准定义",
  "essence": "核心技术本质",
  "context": "当前语境作用"
}

以下是你正在阅读的书籍内容：
${bookText}`
      : "你是一个只输出 JSON 字符串的技术字典，禁止任何自然语言寒暄。";

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        stream: true,
        temperature: 0.2,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DeepSeek API error:", response.status, errorText);
      return Response.json(
        { error: `DeepSeek API 返回错误: ${response.status}` },
        { status: response.status },
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const buffer: string[] = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

            for (const line of lines) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || "";
                if (content) {
                  buffer.push(content);
                  controller.enqueue(encoder.encode(content));
                }
              } catch {
                // skip malformed JSON lines
              }
            }
          }
        } catch (err) {
          console.error("Stream read error:", err);
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return Response.json({ error: "内部服务器错误" }, { status: 500 });
  }
}
