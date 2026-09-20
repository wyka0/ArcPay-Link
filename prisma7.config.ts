// Prisma 7 project configuration.
//
// In Prisma 7 the datasource connection is configured here (not in
// schema.prisma). `DATABASE_URL` is read at runtime; it is never committed.

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
