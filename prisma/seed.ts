import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VENDOR_ALIASES: Array<{ alias: string; canonicalName: string }> = [
  { alias: "netflix", canonicalName: "Netflix" },
  { alias: "netflix.com", canonicalName: "Netflix" },
  { alias: "spotify", canonicalName: "Spotify" },
  { alias: "spotify.com", canonicalName: "Spotify" },
  { alias: "adobe", canonicalName: "Adobe" },
  { alias: "adobe.com", canonicalName: "Adobe" },
  { alias: "microsoft 365", canonicalName: "Microsoft 365" },
  { alias: "office 365", canonicalName: "Microsoft 365" },
  { alias: "google one", canonicalName: "Google One" },
  { alias: "icloud+", canonicalName: "iCloud+" },
  { alias: "apple.com/icloud", canonicalName: "iCloud+" },
  { alias: "amazon prime", canonicalName: "Amazon Prime" },
  { alias: "prime video", canonicalName: "Prime Video" },
  { alias: "amazon music", canonicalName: "Amazon Music" },
  { alias: "github", canonicalName: "GitHub" },
  { alias: "github.com", canonicalName: "GitHub" },
  { alias: "openai", canonicalName: "OpenAI" },
  { alias: "chatgpt plus", canonicalName: "OpenAI" },
];

async function main() {
  for (const row of VENDOR_ALIASES) {
    await prisma.vendorAlias.upsert({
      where: { alias: row.alias },
      update: { canonicalName: row.canonicalName },
      create: row,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
