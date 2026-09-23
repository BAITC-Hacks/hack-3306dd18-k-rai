import type { Metadata } from "next";
import "@fontsource/golos-text/cyrillic-400.css";
import "@fontsource/golos-text/cyrillic-500.css";
import "@fontsource/golos-text/cyrillic-600.css";
import "@fontsource/golos-text/latin-400.css";
import "@fontsource/golos-text/latin-500.css";
import "@fontsource/golos-text/latin-600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Граф денег",
  description:
    "Восстановление финансовой структуры организованной группы по транзакционной сети: роли узлов, кластеры и приоритеты проверки.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
