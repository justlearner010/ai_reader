import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Reader - 智能读书助手",
  description: "双栏布局电子书阅读器与 AI 聊天助手",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
