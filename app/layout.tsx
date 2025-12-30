
import "./globals.css"
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ background: "#0f172a", color: "white" }}>
        {children}
      </body>
    </html>
  )
}
