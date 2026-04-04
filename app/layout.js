import { Noto_Sans_KR } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const noto = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
});

export const metadata = {
  title: "🎮 AI 체험관",
  description: "Realize Academy 3주차 AI 체험 프로젝트",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body className={noto.className}>
        {children}
        <Script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js" strategy="beforeInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/@teachablemachine/image@latest/dist/teachablemachine-image.min.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
