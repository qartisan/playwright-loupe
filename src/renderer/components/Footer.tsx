export function Footer({ version }: { version: string }) {
  return (
    <footer class="footer">
      Loupe — a reporter for Playwright <span class="muted">· v{version}</span>
    </footer>
  );
}
