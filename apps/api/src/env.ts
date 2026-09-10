export const env = {
  port: Number(process.env.PORT ?? 4000),
  scannerUrl: process.env.SCANNER_URL ?? "http://localhost:3100",
  databaseUrl: process.env.DATABASE_URL ?? "",
};
