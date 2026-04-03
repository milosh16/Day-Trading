import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIGNAL",
  description: "AI-Powered Trading Intelligence",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SIGNAL",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* Auto-recover from chunk loading failures after deployments */}
        <script dangerouslySetInnerHTML={{ __html: `
          window.addEventListener('error', function(e) {
            if (e.message && (e.message.includes('ChunkLoadError') || e.message.includes('Loading chunk') || e.message.includes('load failed') || e.message.includes('Failed to fetch dynamically imported module'))) {
              var reloaded = sessionStorage.getItem('chunk-reload');
              if (!reloaded) {
                sessionStorage.setItem('chunk-reload', '1');
                window.location.reload();
              }
            }
          });
          window.addEventListener('unhandledrejection', function(e) {
            if (e.reason && e.reason.message && (e.reason.message.includes('ChunkLoadError') || e.reason.message.includes('load failed') || e.reason.message.includes('Failed to fetch dynamically imported module'))) {
              var reloaded = sessionStorage.getItem('chunk-reload');
              if (!reloaded) {
                sessionStorage.setItem('chunk-reload', '1');
                window.location.reload();
              }
            }
          });
          // Clear the reload flag on successful page load
          window.addEventListener('load', function() { sessionStorage.removeItem('chunk-reload'); });
        `}} />
      </head>
      <body className="font-sans bg-ios-black text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
