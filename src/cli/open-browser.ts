import open from "open";

export async function openBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // Fallback: just print the URL
    console.log(`  Open your browser to: ${url}`);
  }
}
